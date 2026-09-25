import type { Request } from 'express';
import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { DateFrom, DateTo } from '../../lib/common-schemas.js';
import { sqlWarehouseScope, tenant, warehouseFilter } from '../../lib/tenant.js';
import { MovementOut } from '../inventory/inventory.schemas.js';
import { movementInclude } from '../inventory/inventory.service.js';

const num = (v: unknown) => Number(v ?? 0);
const dec = (v: unknown) => (v == null ? '0' : new Prisma.Decimal(v as Prisma.Decimal.Value).toFixed(2));
const DAY = 86_400_000;

/** Filtros comunes: rango de fechas y alcance (almacén o sucursal). */
const ScopeQuery = z.object({
  warehouseId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().openapi({ description: 'Filtrar por sucursal' }),
});
const RangeQuery = ScopeQuery.extend({
  from: DateFrom.optional().openapi({ description: 'Por defecto: hace 30 días' }),
  to: DateTo.optional().openapi({ description: 'Por defecto: ahora' }),
});

function range(q: { from?: Date; to?: Date }) {
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * DAY);
  return { from, to };
}

/** Condición SQL: empresa + sucursales permitidas + filtros de almacén/sucursal solicitados. */
async function scopeSql(req: Request, alias: string, q: { warehouseId?: string; branchId?: string }) {
  const wh = await sqlWarehouseScope(req, alias, q.warehouseId);
  const branch = q.branchId
    ? Prisma.sql`AND ${Prisma.raw(alias)}."warehouseId" IN (SELECT id FROM warehouses WHERE "branchId" = ${q.branchId}::uuid)`
    : Prisma.empty;
  return Prisma.sql`${wh} ${branch}`;
}

const DashboardOut = z
  .object({
    totals: z.object({
      products: z.number(),
      warehouses: z.number(),
      branches: z.number(),
      suppliers: z.number(),
      customers: z.number(),
      units: z.number(),
      reservedUnits: z.number(),
      inventoryValue: z.string(),
      inventoryRetailValue: z.string(),
      lowStock: z.number(),
      outOfStock: z.number(),
      pendingPurchaseOrders: z.number(),
      pendingSalesOrders: z.number(),
    }),
    movementsByDay: z.array(z.object({ date: z.string(), in: z.number(), out: z.number() })),
    recentMovements: z.array(MovementOut),
  })
  .openapi('Dashboard');

export const reportsRouter = new ApiRouter('/reports', 'Reportes')
  .get('/dashboard', { summary: 'Indicadores generales del inventario', role: 'VIEWER', query: ScopeQuery, response: DashboardOut }, async ({ req, query }) => {
    const t = tenant(req);
    const since = new Date(Date.now() - 30 * DAY);
    const s = await scopeSql(req, 's', query);
    const m = await scopeSql(req, 'm', query);
    const whFilter = await warehouseFilter(req, query.warehouseId);
    const orderWhere = { companyId: t.companyId, ...whFilter, ...(query.branchId && { warehouse: { branchId: query.branchId } }) };

    const [products, warehouses, branches, suppliers, customers, valuation, stockStatus, pendingPO, pendingSO, byDay, recent] = await Promise.all([
      prisma.product.count({ where: { companyId: t.companyId, deletedAt: null, isActive: true } }),
      prisma.warehouse.count({ where: { companyId: t.companyId, isActive: true, ...(t.branchIds && { branchId: { in: t.branchIds } }) } }),
      prisma.branch.count({ where: { companyId: t.companyId, isActive: true, ...(t.branchIds && { id: { in: t.branchIds } }) } }),
      prisma.supplier.count({ where: { companyId: t.companyId, isActive: true } }),
      prisma.customer.count({ where: { companyId: t.companyId, isActive: true } }),
      prisma.$queryRaw<{ units: bigint; reserved: bigint; value: Prisma.Decimal; retail: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM(s.quantity), 0) AS units, COALESCE(SUM(s.reserved), 0) AS reserved,
               COALESCE(SUM(s.quantity * p."costPrice"), 0) AS value,
               COALESCE(SUM(s.quantity * p."salePrice"), 0) AS retail
        FROM stocks s JOIN products p ON p.id = s."productId"
        WHERE p."companyId" = ${t.companyId}::uuid AND p."deletedAt" IS NULL ${s}`,
      prisma.$queryRaw<{ low: bigint; out: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE total <= "minStock") AS low, COUNT(*) FILTER (WHERE total <= 0) AS out
        FROM (SELECT p.id, p."minStock", COALESCE(SUM(s.quantity), 0) AS total
              FROM products p LEFT JOIN stocks s ON s."productId" = p.id ${s}
              WHERE p."companyId" = ${t.companyId}::uuid AND p."deletedAt" IS NULL AND p."isActive" = true GROUP BY p.id) t`,
      prisma.purchaseOrder.count({ where: { ...orderWhere, status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } } }),
      prisma.salesOrder.count({ where: { ...orderWhere, status: { in: ['DRAFT', 'CONFIRMED'] } } }),
      prisma.$queryRaw<{ date: Date; in: bigint; out: bigint }[]>`
        SELECT d::date AS date,
               COALESCE(SUM(m.quantity) FILTER (WHERE m.quantity > 0 AND m.type NOT IN ('TRANSFER_IN')), 0) AS in,
               COALESCE(-SUM(m.quantity) FILTER (WHERE m.quantity < 0 AND m.type NOT IN ('TRANSFER_OUT')), 0) AS out
        FROM generate_series(${since}::date, CURRENT_DATE, interval '1 day') d
        LEFT JOIN stock_movements m ON m."createdAt"::date = d::date AND m."companyId" = ${t.companyId}::uuid ${m}
        GROUP BY d ORDER BY d`,
      prisma.stockMovement.findMany({
        where: { companyId: t.companyId, ...whFilter, ...(query.branchId && { warehouse: { branchId: query.branchId } }) },
        include: movementInclude,
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      totals: {
        products,
        warehouses,
        branches,
        suppliers,
        customers,
        units: num(valuation[0]?.units),
        reservedUnits: num(valuation[0]?.reserved),
        inventoryValue: dec(valuation[0]?.value),
        inventoryRetailValue: dec(valuation[0]?.retail),
        lowStock: num(stockStatus[0]?.low),
        outOfStock: num(stockStatus[0]?.out),
        pendingPurchaseOrders: pendingPO,
        pendingSalesOrders: pendingSO,
      },
      movementsByDay: byDay.map((r) => ({ date: r.date.toISOString().slice(0, 10), in: num(r.in), out: num(r.out) })),
      recentMovements: recent,
    };
  })
  .get(
    '/low-stock',
    {
      summary: 'Productos con stock bajo y sugerencia de reposición',
      role: 'VIEWER',
      query: ScopeQuery,
      response: z.array(
        z.object({
          id: z.string(),
          sku: z.string(),
          name: z.string(),
          unit: z.string(),
          minStock: z.number(),
          maxStock: z.number().nullable(),
          totalStock: z.number(),
          suggestedOrder: z.number(),
          supplierId: z.string().nullable(),
          supplierName: z.string().nullable(),
        }),
      ),
    },
    async ({ req, query }) => {
      const t = tenant(req);
      const s = await scopeSql(req, 's', query);
      const rows = await prisma.$queryRaw<
        { id: string; sku: string; name: string; unit: string; minStock: number; maxStock: number | null; total: bigint; supplierId: string | null; supplierName: string | null }[]
      >`
        SELECT p.id, p.sku, p.name, p.unit, p."minStock", p."maxStock", COALESCE(SUM(s.quantity), 0) AS total,
               p."supplierId", sup.name AS "supplierName"
        FROM products p
        LEFT JOIN stocks s ON s."productId" = p.id ${s}
        LEFT JOIN suppliers sup ON sup.id = p."supplierId"
        WHERE p."companyId" = ${t.companyId}::uuid AND p."deletedAt" IS NULL AND p."isActive" = true
        GROUP BY p.id, sup.name
        HAVING COALESCE(SUM(s.quantity), 0) <= p."minStock"
        ORDER BY (COALESCE(SUM(s.quantity), 0) - p."minStock") ASC, p.name`;
      return rows.map(({ total, ...r }) => {
        const totalStock = num(total);
        const target = r.maxStock ?? Math.max(r.minStock * 2, 1);
        return { ...r, totalStock, suggestedOrder: Math.max(0, target - totalStock) };
      });
    },
  )
  .get(
    '/valuation',
    {
      summary: 'Valorización del inventario',
      description: 'Agrupa el valor (a costo y a precio de venta) por categoría, sucursal o almacén.',
      role: 'VIEWER',
      query: ScopeQuery.extend({ groupBy: z.enum(['category', 'branch', 'warehouse']).default('category') }),
      response: z.array(z.object({ id: z.string().nullable(), name: z.string(), units: z.number(), costValue: z.string(), retailValue: z.string() })),
    },
    async ({ req, query }) => {
      const t = tenant(req);
      const s = await scopeSql(req, 's', query);
      type Row = { id: string | null; name: string; units: bigint; cost: Prisma.Decimal; retail: Prisma.Decimal };
      const base = Prisma.sql`FROM stocks s JOIN products p ON p.id = s."productId" JOIN warehouses w ON w.id = s."warehouseId"`;
      const where = Prisma.sql`WHERE p."companyId" = ${t.companyId}::uuid AND p."deletedAt" IS NULL ${s}`;
      const totals = Prisma.sql`SUM(s.quantity) AS units, SUM(s.quantity * p."costPrice") AS cost, SUM(s.quantity * p."salePrice") AS retail`;
      const rows =
        query.groupBy === 'warehouse'
          ? await prisma.$queryRaw<Row[]>`SELECT w.id, w.code || ' — ' || w.name AS name, ${totals} ${base} ${where} GROUP BY w.id ORDER BY cost DESC`
          : query.groupBy === 'branch'
            ? await prisma.$queryRaw<Row[]>`SELECT b.id, b.name, ${totals} ${base} JOIN branches b ON b.id = w."branchId" ${where} GROUP BY b.id ORDER BY cost DESC`
            : await prisma.$queryRaw<Row[]>`
                SELECT c.id, COALESCE(c.name, 'Sin categoría') AS name, ${totals} ${base}
                LEFT JOIN categories c ON c.id = p."categoryId" ${where} GROUP BY c.id, c.name ORDER BY cost DESC`;
      return rows.map((r) => ({ id: r.id, name: r.name, units: num(r.units), costValue: dec(r.cost), retailValue: dec(r.retail) }));
    },
  )
  .get(
    '/movements-summary',
    {
      summary: 'Resumen de movimientos por tipo',
      role: 'VIEWER',
      query: RangeQuery,
      response: z.object({
        from: z.string(),
        to: z.string(),
        byType: z.array(z.object({ type: z.string(), count: z.number(), units: z.number(), value: z.string() })),
      }),
    },
    async ({ req, query }) => {
      const t = tenant(req);
      const { from, to } = range(query);
      const m = await scopeSql(req, 'm', query);
      const rows = await prisma.$queryRaw<{ type: string; count: bigint; units: bigint; value: Prisma.Decimal }[]>`
        SELECT m.type::text AS type, COUNT(*) AS count, SUM(ABS(m.quantity)) AS units,
               COALESCE(SUM(ABS(m.quantity) * m."unitCost"), 0) AS value
        FROM stock_movements m
        WHERE m."companyId" = ${t.companyId}::uuid AND m."createdAt" BETWEEN ${from} AND ${to} ${m}
        GROUP BY m.type ORDER BY m.type`;
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        byType: rows.map((r) => ({ type: r.type, count: num(r.count), units: num(r.units), value: dec(r.value) })),
      };
    },
  )
  .get(
    '/top-products',
    {
      summary: 'Productos con mayor salida',
      description: 'Considera ventas (SALE) y salidas manuales (OUT). Ingresos en montos netos.',
      role: 'VIEWER',
      query: RangeQuery.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) }),
      response: z.array(z.object({ id: z.string(), sku: z.string(), name: z.string(), units: z.number(), revenue: z.string() })),
    },
    async ({ req, query }) => {
      const t = tenant(req);
      const { from, to } = range(query);
      const m = await scopeSql(req, 'm', query);
      const rows = await prisma.$queryRaw<{ id: string; sku: string; name: string; units: bigint; revenue: Prisma.Decimal | null }[]>`
        SELECT p.id, p.sku, p.name, SUM(-m.quantity) AS units,
               SUM(-m.quantity * COALESCE(soi."unitPrice", p."salePrice")) AS revenue
        FROM stock_movements m
        JOIN products p ON p.id = m."productId"
        LEFT JOIN sales_order_items soi ON soi."salesOrderId" = m."salesOrderId" AND soi."productId" = m."productId"
        WHERE m."companyId" = ${t.companyId}::uuid AND m.type IN ('SALE', 'OUT') AND m."createdAt" BETWEEN ${from} AND ${to} ${m}
        GROUP BY p.id ORDER BY units DESC LIMIT ${query.limit}`;
      return rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, units: num(r.units), revenue: dec(r.revenue) }));
    },
  )
  .get(
    '/sales-summary',
    {
      summary: 'Ventas despachadas por día',
      description: 'Montos netos (sin IVA); se informa también el IVA débito del periodo.',
      role: 'VIEWER',
      query: RangeQuery,
      response: z.object({
        totalOrders: z.number(),
        totalRevenue: z.string().openapi({ description: 'Neto' }),
        totalTax: z.string().openapi({ description: 'IVA débito' }),
        byDay: z.array(z.object({ date: z.string(), orders: z.number(), revenue: z.string() })),
      }),
    },
    async ({ req, query }) => {
      const t = tenant(req);
      const { from, to } = range(query);
      const so = await scopeSql(req, 'so', query);
      const rows = await prisma.$queryRaw<{ date: Date; orders: bigint; revenue: Prisma.Decimal; tax: Prisma.Decimal }[]>`
        SELECT so."fulfilledAt"::date AS date, COUNT(*) AS orders, SUM(so.subtotal) AS revenue, SUM(so.tax) AS tax
        FROM sales_orders so
        WHERE so."companyId" = ${t.companyId}::uuid AND so.status = 'FULFILLED' AND so."fulfilledAt" BETWEEN ${from} AND ${to} ${so}
        GROUP BY 1 ORDER BY 1`;
      const byDay = rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), orders: num(r.orders), revenue: dec(r.revenue) }));
      return {
        totalOrders: byDay.reduce((a, r) => a + r.orders, 0),
        totalRevenue: rows.reduce((a, r) => a.add(r.revenue ?? 0), new Prisma.Decimal(0)).toFixed(2),
        totalTax: rows.reduce((a, r) => a.add(r.tax ?? 0), new Prisma.Decimal(0)).toFixed(2),
        byDay,
      };
    },
  );
