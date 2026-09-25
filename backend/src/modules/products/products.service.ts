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
/**
 * Añade `totalStock`, `reservedStock`, `availableStock` e `isLowStock`.
 * Si el usuario está restringido a ciertas sucursales, los totales consideran solo sus almacenes.
 */
export async function withStockTotals<T extends ProductRow>(products: T[], allowedWarehouses: string[] | null = null) {
  if (products.length === 0) return [];
  const sums = await prisma.stock.groupBy({
    by: ['productId'],
    where: { productId: { in: products.map((p) => p.id) }, ...(allowedWarehouses && { warehouseId: { in: allowedWarehouses } }) },
    _sum: { quantity: true, reserved: true },
  });
  const map = new Map(sums.map((s) => [s.productId, { quantity: s._sum.quantity ?? 0, reserved: s._sum.reserved ?? 0 }]));
  return products.map((p) => {
    const { quantity: totalStock, reserved: reservedStock } = map.get(p.id) ?? { quantity: 0, reserved: 0 };
    return { ...p, totalStock, reservedStock, availableStock: totalStock - reservedStock, isLowStock: totalStock <= p.minStock };
  });
}

/** IDs de productos cuyo stock total es ≤ al mínimo configurado. */
export async function lowStockProductIds(companyId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM products p
    LEFT JOIN stocks s ON s."productId" = p.id
    WHERE p."companyId" = ${companyId}::uuid AND p."deletedAt" IS NULL AND p."isActive" = true
    GROUP BY p.id, p."minStock"
    HAVING COALESCE(SUM(s.quantity), 0) <= p."minStock"`;
  return rows.map((r) => r.id);
}

export function buildWhere(companyId: string, q: Partial<z.infer<typeof ListProductsQuery>>): Prisma.ProductWhereInput {
  return {
    companyId,
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

export async function listProducts(companyId: string, allowed: string[] | null, q: z.infer<typeof ListProductsQuery>) {
  const where = buildWhere(companyId, q);
  if (q.lowStock) where.id = { in: await lowStockProductIds(companyId) };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: orderArgs(q, ['name', 'sku', 'createdAt', 'updatedAt', 'salePrice', 'costPrice'], 'name'),
      ...pageArgs(q),
    }),
    prisma.product.count({ where }),
  ]);
  return paginated(await withStockTotals(rows, allowed), total, q);
}

export async function getProduct(companyId: string, allowed: string[] | null, where: Prisma.ProductWhereInput) {
  const product = await prisma.product.findFirst({
    where: { ...where, companyId, deletedAt: null },
    include: {
      ...productInclude,
      stocks: {
        where: allowed ? { warehouseId: { in: allowed } } : undefined,
        include: { warehouse: { select: { id: true, code: true, name: true, branch: { select: { id: true, code: true, name: true } } } } },
        orderBy: { warehouse: { code: 'asc' } },
      },
    },
  });
  if (!product) throw NotFound('Producto');
  const [withTotals] = await withStockTotals([product], allowed);
  return withTotals!;
}

/** Categoría y proveedor deben pertenecer a la misma empresa. */
export async function assertProductRefs(companyId: string, refs: { categoryId?: string | null; supplierId?: string | null }) {
  if (refs.categoryId && !(await prisma.category.findFirst({ where: { id: refs.categoryId, companyId } }))) throw NotFound('Categoría');
  if (refs.supplierId && !(await prisma.supplier.findFirst({ where: { id: refs.supplierId, companyId } }))) throw NotFound('Proveedor');
}
