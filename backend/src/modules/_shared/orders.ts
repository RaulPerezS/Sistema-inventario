import { Prisma, type Tx } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { BadRequest, Conflict, NotFound, Unprocessable } from '../../lib/errors.js';

/** Valida que los productos existan, estén activos y no se repitan. */
export async function loadOrderProducts(tx: Tx, productIds: string[]) {
  if (new Set(productIds).size !== productIds.length) throw BadRequest('Hay productos repetidos en la orden');
  const products = await tx.product.findMany({ where: { id: { in: productIds }, deletedAt: null } });
  const map = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !map.has(id));
  if (missing.length) throw NotFound(`Producto(s) ${missing.join(', ')}`);
  const inactive = products.filter((p) => !p.isActive);
  if (inactive.length) throw Unprocessable(`Producto(s) inactivo(s): ${inactive.map((p) => p.sku).join(', ')}`);
  return map;
}

export interface TaxedLine {
  quantity: number;
  price: Prisma.Decimal | number;
  /** Tasa de IVA en porcentaje (0 si el producto es exento). */
  taxRate: Prisma.Decimal | number;
}

const round = (d: Prisma.Decimal) => d.toDecimalPlaces(env.MONEY_DECIMALS, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Calcula neto, IVA y total de un documento.
 * El IVA se calcula sobre la suma neta de cada tasa y se redondea una sola vez (práctica SII).
 */
export function orderTotals(lines: TaxedLine[]) {
  const byRate = new Map<string, Prisma.Decimal>();
  let subtotal = new Prisma.Decimal(0);
  for (const l of lines) {
    const net = new Prisma.Decimal(l.price).mul(l.quantity);
    subtotal = subtotal.add(net);
    const key = new Prisma.Decimal(l.taxRate).toString();
    byRate.set(key, (byRate.get(key) ?? new Prisma.Decimal(0)).add(net));
  }
  let tax = new Prisma.Decimal(0);
  for (const [rate, net] of byRate) tax = tax.add(net.mul(rate).div(100));
  subtotal = round(subtotal);
  tax = round(tax);
  return { subtotal, tax, total: subtotal.add(tax) };
}

/** Tasa de IVA aplicable a un producto. */
export const taxRateFor = (product: { taxExempt: boolean }) => new Prisma.Decimal(product.taxExempt ? 0 : env.TAX_RATE);

export async function assertActiveRefs(tx: Tx, refs: { warehouseId?: string; supplierId?: string; customerId?: string | null }) {
  if (refs.warehouseId) {
    const w = await tx.warehouse.findUnique({ where: { id: refs.warehouseId } });
    if (!w) throw NotFound('Almacén');
    if (!w.isActive) throw Unprocessable('El almacén está inactivo');
  }
  if (refs.supplierId) {
    const s = await tx.supplier.findUnique({ where: { id: refs.supplierId } });
    if (!s) throw NotFound('Proveedor');
    if (!s.isActive) throw Unprocessable('El proveedor está inactivo');
  }
  if (refs.customerId) {
    const c = await tx.customer.findUnique({ where: { id: refs.customerId } });
    if (!c) throw NotFound('Cliente');
    if (!c.isActive) throw Unprocessable('El cliente está inactivo');
  }
}

/** Transición de estado atómica: solo aplica si el estado actual es uno de `from`. */
export async function transition<S extends string>(
  update: (args: { where: { id: string; status: { in: S[] } }; data: Record<string, unknown> }) => Promise<{ count: number }>,
  id: string,
  from: S[],
  data: Record<string, unknown>,
  label: string,
) {
  const { count } = await update({ where: { id, status: { in: from } }, data });
  if (count === 0) throw Conflict(`La orden no se puede ${label} en su estado actual (permitido desde: ${from.join(', ')})`);
}
