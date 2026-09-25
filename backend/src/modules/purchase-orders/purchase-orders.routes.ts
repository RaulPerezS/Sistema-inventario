import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { DateFrom, DateTo, DecimalOut, IdParams, Money, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { nextNumber } from '../../lib/sequence.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import { applyStockChange, inTransaction } from '../inventory/inventory.service.js';
import { assertActiveRefs, companyTaxRate, loadOrderProducts, orderTotals, taxRateFor, transition } from '../_shared/orders.js';
import { tenant, warehouseFilter, type Tenant } from '../../lib/tenant.js';
import type { Request } from 'express';
import { emit } from '../../lib/webhooks.js';
import type { Tx } from '../../lib/prisma.js';

const StatusEnum = z.enum(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).openapi('PurchaseOrderStatus');

const ItemOut = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int(),
  receivedQuantity: z.number().int(),
  unitCost: DecimalOut.openapi({ description: 'Costo neto unitario' }),
  taxRate: DecimalOut.openapi({ description: 'Tasa de IVA aplicada (%)' }),
  product: z.object({ id: z.string(), sku: z.string(), name: z.string(), unit: z.string() }),
});

const PurchaseOrderOut = z
  .object({
    id: z.string().uuid(),
    number: z.string().openapi({ example: 'OC-000001' }),
    status: StatusEnum,
    expectedDate: z.string().datetime().nullable(),
    notes: z.string().nullable(),
    subtotal: DecimalOut.openapi({ description: 'Neto' }),
    tax: DecimalOut.openapi({ description: 'IVA crédito fiscal' }),
    total: DecimalOut,
    supplier: z.object({ id: z.string(), name: z.string() }),
    warehouse: z.object({ id: z.string(), code: z.string(), name: z.string() }),
    createdBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    orderedAt: z.string().datetime().nullable(),
    receivedAt: z.string().datetime().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    items: z.array(ItemOut),
    ...Timestamps,
  })
  .openapi('PurchaseOrder');

const OrderBody = z
  .object({
    supplierId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    expectedDate: z.coerce.date().nullish().openapi({ type: 'string', format: 'date' }),
    notes: optionalText(1000),
    items: z
      .array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().int().positive(), unitCost: Money }))
      .min(1)
      .max(500),
  })
  .openapi('PurchaseOrderInput');

const ReceiveBody = z
  .object({
    items: z
      .array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().int().positive() }))
      .optional()
      .openapi({ description: 'Si se omite, se recibe todo lo pendiente' }),
    reference: optionalText(100).openapi({ description: 'N° de guía o factura del proveedor' }),
    note: optionalText(500),
  })
  .openapi('ReceivePurchaseOrder');

const ListQuery = PaginationQuery.extend({
  status: StatusEnum.optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  from: DateFrom.optional(),
  to: DateTo.optional(),
});

const include = {
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
} as const;

/** Ítems con la tasa de IVA vigente de cada producto y totales del documento. */
async function buildItems(tx: Tx, t: Tenant, body: z.infer<typeof OrderBody>) {
  await assertActiveRefs(tx, t, { warehouseId: body.warehouseId, supplierId: body.supplierId });
  const products = await loadOrderProducts(tx, t.companyId, body.items.map((i) => i.productId));
  const rate = await companyTaxRate(tx, t.companyId);
  const items = body.items.map((i) => ({ ...i, taxRate: taxRateFor(products.get(i.productId)!, rate) }));
  return { items, ...orderTotals(items.map((i) => ({ quantity: i.quantity, price: i.unitCost, taxRate: i.taxRate }))) };
}

const statusEvent = (req: Request, id: string, status: string) =>
  findOrder(req, id).then((order) => emit(order.companyId, 'purchase_order.status_changed', { status, order }));

/** Orden de la empresa activa y de una sucursal permitida. */
async function findOrder(req: Request, id: string) {
  const order = await prisma.purchaseOrder.findFirst({ where: { id, companyId: tenant(req).companyId, ...(await warehouseFilter(req)) }, include });
  if (!order) throw NotFound('Orden de compra');
  return order;
}

export const purchaseOrdersRouter = new ApiRouter('/purchase-orders', 'Órdenes de compra')
  .get('/', { summary: 'Listar órdenes de compra', role: 'VIEWER', query: ListQuery, response: paginatedOf(PurchaseOrderOut) }, async ({ req, query }) => {
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: tenant(req).companyId,
      ...(await warehouseFilter(req, query.warehouseId)),
      ...(query.branchId && { warehouse: { branchId: query.branchId } }),
      status: query.status,
      supplierId: query.supplierId,
      ...((query.from || query.to) && { createdAt: { gte: query.from, lte: query.to } }),
      ...(query.search && {
        OR: [
          { number: { contains: query.search, mode: 'insensitive' } },
          { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, include, orderBy: orderArgs(query, ['createdAt', 'number', 'total', 'expectedDate'], 'createdAt'), ...pageArgs(query) }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return paginated(data, total, query);
  })
  .get('/:id', { summary: 'Obtener orden de compra', role: 'VIEWER', params: IdParams, response: PurchaseOrderOut }, ({ req, params }) => findOrder(req, params.id))
  .post('/', { summary: 'Crear orden de compra (borrador)', role: 'MANAGER', body: OrderBody, response: PurchaseOrderOut, status: 201 }, async ({ req, body }) => {
    const id = await inTransaction(async (tx) => {
      const t = tenant(req);
      const { items, subtotal, tax, total } = await buildItems(tx, t, body);
      const order = await tx.purchaseOrder.create({
        data: {
          companyId: t.companyId,
          number: await nextNumber(tx, t.companyId, 'purchase_order', 'OC'),
          supplierId: body.supplierId,
          warehouseId: body.warehouseId,
          expectedDate: body.expectedDate,
          notes: body.notes,
          createdById: req.auth?.userId,
          subtotal,
          tax,
          total,
          items: { create: items },
        },
      });
      return order.id;
    });
    await audit(req, { action: 'CREATE', entity: 'PurchaseOrder', entityId: id, changes: body });
    const created = await findOrder(req, id);
    await emit(created.companyId, 'purchase_order.created', created);
    return created;
  })
  .put(
    '/:id',
    { summary: 'Reemplazar orden (solo en borrador)', role: 'MANAGER', params: IdParams, body: OrderBody, response: PurchaseOrderOut },
    async ({ req, params, body }) => {
      await inTransaction(async (tx) => {
        const order = await findOrder(req, params.id);
        if (order.status !== 'DRAFT') throw Conflict('Solo se pueden editar órdenes en borrador');
        const { items, subtotal, tax, total } = await buildItems(tx, tenant(req), body);
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: order.id } });
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: {
            supplierId: body.supplierId,
            warehouseId: body.warehouseId,
            expectedDate: body.expectedDate,
            notes: body.notes,
            subtotal,
            tax,
            total,
            items: { create: items },
          },
        });
      });
      await audit(req, { action: 'UPDATE', entity: 'PurchaseOrder', entityId: params.id, changes: body });
      return findOrder(req, params.id);
    },
  )
  .post('/:id/order', { summary: 'Emitir orden al proveedor', description: 'DRAFT → ORDERED', role: 'MANAGER', params: IdParams, response: PurchaseOrderOut }, async ({ req, params }) => {
    await findOrder(req, params.id);
    await transition((a) => prisma.purchaseOrder.updateMany(a), params.id, ['DRAFT'], { status: 'ORDERED', orderedAt: new Date() }, 'emitir');
    await audit(req, { action: 'ORDER', entity: 'PurchaseOrder', entityId: params.id });
    await statusEvent(req, params.id, 'ORDERED');
    return findOrder(req, params.id);
  })
  .post(
    '/:id/receive',
    {
      summary: 'Recibir mercadería (total o parcial)',
      description: 'Genera movimientos de tipo PURCHASE y actualiza el costo promedio. ORDERED/PARTIALLY_RECEIVED → PARTIALLY_RECEIVED/RECEIVED',
      role: 'OPERATOR',
      params: IdParams,
      body: ReceiveBody,
      response: PurchaseOrderOut,
    },
    async ({ req, params, body }) => {
      await inTransaction(async (tx) => {
        // Bloqueo de la orden para evitar recepciones concurrentes duplicadas
        await findOrder(req, params.id);
        await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${params.id}::uuid FOR UPDATE`;
        const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: params.id }, include: { items: true } });
        if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
          throw Conflict('Solo se pueden recibir órdenes emitidas o parcialmente recibidas');
        }
        const pending = new Map(order.items.map((i) => [i.productId, i]));
        const toReceive =
          body.items ?? order.items.filter((i) => i.quantity > i.receivedQuantity).map((i) => ({ productId: i.productId, quantity: i.quantity - i.receivedQuantity }));
        if (toReceive.length === 0) throw BadRequest('No hay cantidades pendientes de recibir');

        for (const r of toReceive) {
          const item = pending.get(r.productId);
          if (!item) throw BadRequest(`El producto ${r.productId} no pertenece a la orden`);
          const remaining = item.quantity - item.receivedQuantity;
          if (r.quantity > remaining) throw BadRequest(`Cantidad a recibir (${r.quantity}) supera lo pendiente (${remaining})`, { productId: r.productId });
          await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: r.quantity } } });
          item.receivedQuantity += r.quantity;
          await applyStockChange(tx, {
            tenant: tenant(req),
            type: 'PURCHASE',
            productId: r.productId,
            warehouseId: order.warehouseId,
            delta: r.quantity,
            unitCost: item.unitCost,
            updateAverageCost: true,
            reference: body.reference ?? order.number,
            note: body.note,
            userId: req.auth?.userId,
            purchaseOrderId: order.id,
          });
        }
        const complete = order.items.every((i) => i.receivedQuantity >= i.quantity);
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', ...(complete && { receivedAt: new Date() }) },
        });
      });
      await audit(req, { action: 'RECEIVE', entity: 'PurchaseOrder', entityId: params.id, changes: body });
      const order = await findOrder(req, params.id);
      await emit(order.companyId, 'purchase_order.status_changed', { status: order.status, order });
      return order;
    },
  )
  .post('/:id/cancel', { summary: 'Cancelar orden', description: 'Solo DRAFT u ORDERED sin recepciones.', role: 'MANAGER', params: IdParams, response: PurchaseOrderOut }, async ({ req, params }) => {
    await findOrder(req, params.id);
    await transition((a) => prisma.purchaseOrder.updateMany(a), params.id, ['DRAFT', 'ORDERED'], { status: 'CANCELLED', cancelledAt: new Date() }, 'cancelar');
    await audit(req, { action: 'CANCEL', entity: 'PurchaseOrder', entityId: params.id });
    await statusEvent(req, params.id, 'CANCELLED');
    return findOrder(req, params.id);
  })
  .delete('/:id', { summary: 'Eliminar orden en borrador', role: 'MANAGER', params: IdParams }, async ({ req, params }) => {
    await findOrder(req, params.id);
    const { count } = await prisma.purchaseOrder.deleteMany({ where: { id: params.id, status: 'DRAFT' } });
    if (count === 0) {
      throw Conflict('Solo se pueden eliminar órdenes en borrador');
    }
    await audit(req, { action: 'DELETE', entity: 'PurchaseOrder', entityId: params.id });
  });
