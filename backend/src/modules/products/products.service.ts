import { prisma, Prisma } from '../../lib/prisma.js';
import { orderArgs, pageArgs, paginated } from '../../lib/pagination.js';
import { NotFound } from '../../lib/errors.js';
import type { z } from '../../docs/zod.js';
import type { ListProductsQuery } from './products.schemas.js';

export const productInclude = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} as const;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** Añade `totalStock` e `isLowStock` a cada producto. */
export async function withStockTotals<T extends ProductRow>(products: T[]) {
  if (products.length === 0) return [];
  const sums = await prisma.stock.groupBy({
    by: ['productId'],
    where: { productId: { in: products.map((p) => p.id) } },
    _sum: { quantity: true, reserved: true },
  });
  const map = new Map(sums.map((s) => [s.productId, { quantity: s._sum.quantity ?? 0, reserved: s._sum.reserved ?? 0 }]));
  return products.map((p) => {
    const { quantity: totalStock, reserved: reservedStock } = map.get(p.id) ?? { quantity: 0, reserved: 0 };
    return { ...p, totalStock, reservedStock, availableStock: totalStock - reservedStock, isLowStock: totalStock <= p.minStock };
  });
}

/** IDs de productos cuyo stock total es ≤ al mínimo configurado. */
export async function lowStockProductIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM products p
    LEFT JOIN stocks s ON s."productId" = p.id
    WHERE p."deletedAt" IS NULL AND p."isActive" = true
    GROUP BY p.id, p."minStock"
    HAVING COALESCE(SUM(s.quantity), 0) <= p."minStock"`;
  return rows.map((r) => r.id);
}

export function buildWhere(q: Partial<z.infer<typeof ListProductsQuery>>): Prisma.ProductWhereInput {
  return {
    deletedAt: null,
    categoryId: q.categoryId,
    supplierId: q.supplierId,
    isActive: q.isActive,
    ...(q.search && {
      OR: [
        { name: { contains: q.search, mode: 'insensitive' } },
        { sku: { contains: q.search, mode: 'insensitive' } },
        { barcode: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
      ],
    }),
  };
}

export async function listProducts(q: z.infer<typeof ListProductsQuery>) {
  const where = buildWhere(q);
  if (q.lowStock) where.id = { in: await lowStockProductIds() };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: orderArgs(q, ['name', 'sku', 'createdAt', 'updatedAt', 'salePrice', 'costPrice'], 'name'),
      ...pageArgs(q),
    }),
    prisma.product.count({ where }),
  ]);
  return paginated(await withStockTotals(rows), total, q);
}

export async function getProduct(where: Prisma.ProductWhereInput) {
  const product = await prisma.product.findFirst({
    where: { ...where, deletedAt: null },
    include: {
      ...productInclude,
      stocks: { include: { warehouse: { select: { id: true, code: true, name: true } } }, orderBy: { warehouse: { code: 'asc' } } },
    },
  });
  if (!product) throw NotFound('Producto');
  const [withTotals] = await withStockTotals([product]);
  return withTotals!;
}
