import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { orderArgs, pageArgs, paginated } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { toCsv } from '../../lib/csv.js';
import { emit, notifyLowStock } from '../../lib/webhooks.js';
import { applyStockChange, assertUniqueProducts, inTransaction, movementInclude } from './inventory.service.js';
import {
  AdjustmentBody,
  EntryBody,
  ExitBody,
  MovementOut,
  MovementsQuery,
  StockOut,
  StockQuery,
  TransferBody,
} from './inventory.schemas.js';

const MovementsResult = z.object({ movements: z.array(MovementOut) }).openapi('MovementsResult');

export function movementsWhere(q: z.infer<typeof MovementsQuery>): Prisma.StockMovementWhereInput {
  return {
    productId: q.productId,
    warehouseId: q.warehouseId,
    type: q.type,
    ...((q.from || q.to) && { createdAt: { gte: q.from, lte: q.to } }),
    ...(q.search && {
      OR: [
        { reference: { contains: q.search, mode: 'insensitive' } },
        { note: { contains: q.search, mode: 'insensitive' } },
        { product: { name: { contains: q.search, mode: 'insensitive' } } },
        { product: { sku: { contains: q.search, mode: 'insensitive' } } },
      ],
    }),
  };
}

const userId = (req: Request) => req.auth?.userId ?? null;

export const inventoryRouter = new ApiRouter('/inventory', 'Inventario')
  .get(
    '/stock',
    { summary: 'Existencias por producto y almacén', role: 'VIEWER', query: StockQuery, response: paginatedOf(StockOut) },
    async ({ query }) => {
      const where: Prisma.StockWhereInput = {
        warehouseId: query.warehouseId,
        productId: query.productId,
        ...(query.onlyAvailable && { quantity: { gt: 0 } }),
        product: {
          deletedAt: null,
          categoryId: query.categoryId,
          ...(query.search && {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { barcode: { contains: query.search, mode: 'insensitive' } },
            ],
          }),
        },
      };
      const [data, total] = await Promise.all([
        prisma.stock.findMany({
          where,
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true, minStock: true, costPrice: true } },
            warehouse: { select: { id: true, code: true, name: true } },
          },
          orderBy: orderArgs(query, ['quantity', 'updatedAt'], 'updatedAt'),
          ...pageArgs(query),
        }),
        prisma.stock.count({ where }),
      ]);
      return paginated(
        data.map((s) => ({ ...s, available: s.quantity - s.reserved })),
        total,
        query,
      );
    },
  )
  .get(
    '/movements',
    { summary: 'Historial de movimientos (kardex)', role: 'VIEWER', query: MovementsQuery, response: paginatedOf(MovementOut) },
    async ({ query }) => {
      const where = movementsWhere(query);
      const [data, total] = await Promise.all([
        prisma.stockMovement.findMany({ where, include: movementInclude, orderBy: orderArgs(query, ['createdAt', 'quantity'], 'createdAt'), ...pageArgs(query) }),
        prisma.stockMovement.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .get(
    '/movements/export',
    { summary: 'Exportar movimientos a CSV', description: 'Máximo 50.000 filas.', role: 'VIEWER', query: MovementsQuery.omit({ page: true, limit: true }), produces: 'text/csv' },
    async ({ query, res }) => {
      const rows = await prisma.stockMovement.findMany({
        where: movementsWhere({ ...query, page: 1, limit: 1 }),
        include: movementInclude,
        orderBy: { createdAt: 'desc' },
        take: 50_000,
      });
      const csv = toCsv(
        rows.map((m) => ({
          fecha: m.createdAt,
          tipo: m.type,
          sku: m.product.sku,
          producto: m.product.name,
          almacen: m.warehouse.code,
          cantidad: m.quantity,
          saldo: m.balanceAfter,
          costo: m.unitCost?.toString() ?? '',
          referencia: m.reference,
          nota: m.note,
          usuario: m.user?.name ?? '',
        })),
        [
          { key: 'fecha', header: 'Fecha' },
          { key: 'tipo', header: 'Tipo' },
          { key: 'sku', header: 'SKU' },
          { key: 'producto', header: 'Producto' },
          { key: 'almacen', header: 'Almacén' },
          { key: 'cantidad', header: 'Cantidad' },
          { key: 'saldo', header: 'Saldo' },
          { key: 'costo', header: 'Costo unitario' },
          { key: 'referencia', header: 'Referencia' },
          { key: 'nota', header: 'Nota' },
          { key: 'usuario', header: 'Usuario' },
        ],
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="movimientos-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    },
  )
  .post(
    '/entries',
    {
      summary: 'Registrar entrada de mercadería',
      description: 'Si se indica `unitCost` (neto), se recalcula el costo promedio ponderado del producto.',
      role: 'OPERATOR',
      body: EntryBody,
      response: MovementsResult,
      status: 201,
    },
    async ({ req, body }) => {
      assertUniqueProducts(body.items);
      const movements = await inTransaction(async (tx) => {
        const out = [];
        for (const item of body.items) {
          out.push(
            await applyStockChange(tx, {
              type: 'IN',
              productId: item.productId,
              warehouseId: body.warehouseId,
              delta: item.quantity,
              unitCost: item.unitCost,
              updateAverageCost: item.unitCost !== undefined,
              reference: body.reference,
              note: body.note,
              userId: userId(req),
            }),
          );
        }
        return out;
      });
      await audit(req, { action: 'STOCK_IN', entity: 'StockMovement', changes: body });
      await emit('inventory.movements.created', { movements });
      return { movements };
    },
  )
  .post(
    '/exits',
    { summary: 'Registrar salida de mercadería', description: 'Solo puede usar el stock disponible (físico − reservado por ventas confirmadas). Falla con 422 si no alcanza.', role: 'OPERATOR', body: ExitBody, response: MovementsResult, status: 201 },
    async ({ req, body }) => {
      assertUniqueProducts(body.items);
      const movements = await inTransaction(async (tx) => {
        const out = [];
        for (const item of body.items) {
          out.push(
            await applyStockChange(tx, {
              type: 'OUT',
              productId: item.productId,
              warehouseId: body.warehouseId,
              delta: -item.quantity,
              reference: body.reference,
              note: body.note,
              userId: userId(req),
            }),
          );
        }
        return out;
      });
      await audit(req, { action: 'STOCK_OUT', entity: 'StockMovement', changes: body });
      await emit('inventory.movements.created', { movements });
      await notifyLowStock(body.items.map((i) => i.productId));
      return { movements };
    },
  )
  .post(
    '/adjustments',
    { summary: 'Ajuste por conteo físico', role: 'MANAGER', body: AdjustmentBody, response: MovementsResult, status: 201 },
    async ({ req, body }) => {
      assertUniqueProducts(body.items);
      const movements = await inTransaction(async (tx) => {
        const out = [];
        for (const item of body.items) {
          // Bloquea la fila para que el conteo no compita con otras operaciones
          const rows = await tx.$queryRaw<{ quantity: number }[]>`
            SELECT quantity FROM stocks WHERE "productId" = ${item.productId}::uuid AND "warehouseId" = ${body.warehouseId}::uuid FOR UPDATE`;
          const current = rows[0]?.quantity ?? 0;
          const delta = item.countedQuantity - current;
          if (delta === 0) continue;
          out.push(
            await applyStockChange(tx, {
              type: 'ADJUSTMENT',
              productId: item.productId,
              warehouseId: body.warehouseId,
              delta,
              reference: body.reference,
              note: body.note ?? `Conteo físico: ${current} → ${item.countedQuantity}`,
              userId: userId(req),
            }),
          );
        }
        return out;
      });
      await audit(req, { action: 'STOCK_ADJUSTMENT', entity: 'StockMovement', changes: body });
      await emit('inventory.movements.created', { movements });
      await notifyLowStock(body.items.map((i) => i.productId));
      return { movements };
    },
  )
  .post(
    '/transfers',
    { summary: 'Transferencia entre almacenes', role: 'OPERATOR', body: TransferBody, response: MovementsResult.extend({ transferId: z.string().uuid() }), status: 201 },
    async ({ req, body }) => {
      assertUniqueProducts(body.items);
      const transferId = randomUUID();
      const movements = await inTransaction(async (tx) => {
        const out = [];
        for (const item of body.items) {
          const common = { productId: item.productId, transferId, reference: body.reference, note: body.note, userId: userId(req) };
          out.push(await applyStockChange(tx, { ...common, type: 'TRANSFER_OUT', warehouseId: body.fromWarehouseId, delta: -item.quantity }));
          out.push(await applyStockChange(tx, { ...common, type: 'TRANSFER_IN', warehouseId: body.toWarehouseId, delta: item.quantity }));
        }
        return out;
      });
      await audit(req, { action: 'STOCK_TRANSFER', entity: 'StockMovement', entityId: transferId, changes: body });
      await emit('inventory.movements.created', { transferId, movements });
      return { transferId, movements };
    },
  );
