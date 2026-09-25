import type { MovementType } from '@prisma/client';
import { prisma, Prisma, type Tx } from '../../lib/prisma.js';
import { BadRequest, NotFound, Unprocessable } from '../../lib/errors.js';
import { assertWarehouse, type Tenant } from '../../lib/tenant.js';

export interface StockChange {
  /** Empresa y alcance de sucursales de quien opera. */
  tenant: Tenant;
  productId: string;
  warehouseId: string;
  /** Cantidad con signo: positiva = entrada, negativa = salida. */
  delta: number;
  type: MovementType;
  unitCost?: number | Prisma.Decimal | null;
  reference?: string | null;
  note?: string | null;
  userId?: string | null;
  transferId?: string;
  purchaseOrderId?: string;
  salesOrderId?: string;
  /** Recalcula el costo promedio ponderado del producto (entradas con costo). */
  updateAverageCost?: boolean;
  /** La salida consume unidades previamente reservadas (despacho de venta). */
  consumeReserved?: boolean;
}

export const movementInclude = {
  product: { select: { id: true, sku: true, name: true, unit: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true } },
} as const;

async function assertOperable(tx: Tx, t: Tenant, productId: string, warehouseId: string) {
  const product = await tx.product.findFirst({
    where: { id: productId, companyId: t.companyId },
    select: { id: true, sku: true, isActive: true, deletedAt: true, costPrice: true },
  });
  if (!product || product.deletedAt) throw NotFound(`Producto ${productId}`);
  if (!product.isActive) throw Unprocessable(`El producto ${product.sku} está inactivo`);
  await assertWarehouse(tx, t, warehouseId);
  return product;
}

/**
 * Aplica un cambio de stock de forma atómica y registra el movimiento (kardex).
 * Debe ejecutarse dentro de una transacción. Las salidas se validan con un UPDATE condicional
 * (`quantity >= n`), por lo que dos operaciones concurrentes nunca dejan stock negativo.
 */
export async function applyStockChange(tx: Tx, change: StockChange) {
  if (!Number.isInteger(change.delta) || change.delta === 0) throw BadRequest('La cantidad debe ser un entero distinto de cero');
  const product = await assertOperable(tx, change.tenant, change.productId, change.warehouseId);
  const key = { productId: change.productId, warehouseId: change.warehouseId };

  if (change.updateAverageCost && change.delta > 0 && change.unitCost != null) {
    const agg = await tx.stock.aggregate({ where: { productId: change.productId }, _sum: { quantity: true } });
    const currentQty = Math.max(0, agg._sum.quantity ?? 0);
    const unitCost = new Prisma.Decimal(change.unitCost);
    const newCost =
      currentQty === 0
        ? unitCost
        : product.costPrice.mul(currentQty).add(unitCost.mul(change.delta)).div(currentQty + change.delta);
    await tx.product.update({ where: { id: change.productId }, data: { costPrice: newCost.toDecimalPlaces(2) } });
  }

  let balanceAfter: number;
  if (change.delta > 0) {
    const stock = await tx.stock.upsert({
      where: { productId_warehouseId: key },
      create: { ...key, quantity: change.delta },
      update: { quantity: { increment: change.delta } },
    });
    balanceAfter = stock.quantity;
  } else {
    const qty = -change.delta;
    // Salida atómica: solo descuenta lo disponible (físico − reservado), salvo que
    // se esté consumiendo una reserva propia (despacho de una venta confirmada).
    const updated = change.consumeReserved
      ? await tx.$executeRaw`
          UPDATE stocks SET quantity = quantity - ${qty}, reserved = reserved - ${qty}, "updatedAt" = now()
          WHERE "productId" = ${change.productId}::uuid AND "warehouseId" = ${change.warehouseId}::uuid
            AND reserved >= ${qty} AND quantity >= ${qty}`
      : await tx.$executeRaw`
          UPDATE stocks SET quantity = quantity - ${qty}, "updatedAt" = now()
          WHERE "productId" = ${change.productId}::uuid AND "warehouseId" = ${change.warehouseId}::uuid
            AND quantity - reserved >= ${qty}`;
    if (updated === 0) {
      const current = await tx.stock.findUnique({ where: { productId_warehouseId: key } });
      const available = (current?.quantity ?? 0) - (current?.reserved ?? 0);
      const reservedNote = current?.reserved ? ` (${current.reserved} reservadas)` : '';
      throw Unprocessable(`Stock insuficiente para ${product.sku}: disponible ${available}${reservedNote}, solicitado ${qty}`, {
        productId: change.productId,
        warehouseId: change.warehouseId,
        available,
        reserved: current?.reserved ?? 0,
        requested: qty,
      });
    }
    const stock = await tx.stock.findUniqueOrThrow({ where: { productId_warehouseId: key } });
    balanceAfter = stock.quantity;
  }

  return tx.stockMovement.create({
    data: {
      companyId: change.tenant.companyId,
      type: change.type,
      productId: change.productId,
      warehouseId: change.warehouseId,
      quantity: change.delta,
      balanceAfter,
      unitCost: change.unitCost ?? product.costPrice,
      reference: change.reference ?? null,
      note: change.note ?? null,
      userId: change.userId ?? null,
      transferId: change.transferId,
      purchaseOrderId: change.purchaseOrderId,
      salesOrderId: change.salesOrderId,
    },
    include: movementInclude,
  });
}

export function assertUniqueProducts(items: { productId: string }[]) {
  const ids = items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw BadRequest('Hay productos repetidos en la lista de ítems');
}

/** Ejecuta la operación en una transacción con reintentos ante conflictos de serialización. */
export async function inTransaction<T>(fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
    } catch (err) {
      const retryable = err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002');
      if (!retryable || attempt >= retries) throw err;
    }
  }
}

export interface ReservationLine {
  productId: string;
  quantity: number;
  product?: { sku: string };
}

/**
 * Reserva stock para una orden de venta. Es atómico por fila (`quantity - reserved >= n`)
 * y reporta todos los faltantes a la vez; ante cualquier faltante la transacción se revierte.
 */
export async function reserveStock(tx: Tx, warehouseId: string, lines: ReservationLine[]) {
  const shortages: { productId: string; sku?: string; requested: number; available: number }[] = [];
  for (const line of lines) {
    const updated = await tx.$executeRaw`
      UPDATE stocks SET reserved = reserved + ${line.quantity}, "updatedAt" = now()
      WHERE "productId" = ${line.productId}::uuid AND "warehouseId" = ${warehouseId}::uuid
        AND quantity - reserved >= ${line.quantity}`;
    if (updated === 0) {
      const s = await tx.stock.findUnique({ where: { productId_warehouseId: { productId: line.productId, warehouseId } } });
      shortages.push({ productId: line.productId, sku: line.product?.sku, requested: line.quantity, available: (s?.quantity ?? 0) - (s?.reserved ?? 0) });
    }
  }
  if (shortages.length) throw Unprocessable('Stock disponible insuficiente para uno o más productos', { shortages });
}

/** Libera una reserva (cancelación de una orden confirmada). */
export async function releaseReservation(tx: Tx, warehouseId: string, lines: ReservationLine[]) {
  for (const line of lines) {
    await tx.$executeRaw`
      UPDATE stocks SET reserved = GREATEST(reserved - ${line.quantity}, 0), "updatedAt" = now()
      WHERE "productId" = ${line.productId}::uuid AND "warehouseId" = ${warehouseId}::uuid`;
  }
}
