import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery, QueryBool } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { tenant, warehouseScope, type Tenant } from '../../lib/tenant.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';

const WarehouseOut = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    isActive: z.boolean(),
    branchId: z.string().uuid(),
    branch: z.object({ id: z.string(), code: z.string(), name: z.string() }),
    ...Timestamps,
  })
  .openapi('Warehouse');

const WarehouseBody = z
  .object({
    branchId: z.string().uuid().openapi({ description: 'Sucursal a la que pertenece' }),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(20)
      .regex(/^[A-Z0-9_-]+$/, 'Solo letras, números, guion y guion bajo')
      .openapi({ example: 'ALM-01' }),
    name: z.string().trim().min(2).max(120),
    address: optionalText(300),
    isActive: z.boolean().default(true),
  })
  .openapi('WarehouseInput');

const WarehouseSummary = z.object({ totalProducts: z.number(), totalUnits: z.number(), totalValue: z.string() });
const include = { branch: { select: { id: true, code: true, name: true } } } as const;

async function findWarehouse(t: Tenant, id: string) {
  const w = await prisma.warehouse.findFirst({ where: { id, ...warehouseScope(t) }, include });
  if (!w) throw NotFound('Almacén');
  return w;
}

/** La sucursal debe ser de la empresa y estar dentro del alcance del usuario. */
async function assertBranch(t: Tenant, branchId: string | undefined) {
  if (!branchId) return;
  if (t.branchIds && !t.branchIds.includes(branchId)) throw BadRequest('No tiene acceso a esa sucursal');
  if (!(await prisma.branch.findFirst({ where: { id: branchId, companyId: t.companyId } }))) throw NotFound('Sucursal');
}

export const warehousesRouter = new ApiRouter('/warehouses', 'Almacenes')
  .get(
    '/',
    {
      summary: 'Listar almacenes',
      role: 'VIEWER',
      query: PaginationQuery.extend({ isActive: QueryBool.optional(), branchId: z.string().uuid().optional() }),
      response: paginatedOf(WarehouseOut),
    },
    async ({ req, query }) => {
      const t = tenant(req);
      const where: Prisma.WarehouseWhereInput = {
        AND: [
          warehouseScope(t),
          {
            isActive: query.isActive,
            branchId: query.branchId,
            ...(query.search && {
              OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }],
            }),
          },
        ],
      };
      const [data, total] = await Promise.all([
        prisma.warehouse.findMany({ where, include, orderBy: orderArgs(query, ['code', 'name', 'createdAt'], 'code'), ...pageArgs(query) }),
        prisma.warehouse.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .get(
    '/:id',
    { summary: 'Obtener almacén con resumen de existencias', role: 'VIEWER', params: IdParams, response: WarehouseOut.extend({ summary: WarehouseSummary }) },
    async ({ req, params }) => {
      const warehouse = await findWarehouse(tenant(req), params.id);
      const [row] = await prisma.$queryRaw<{ products: bigint; units: bigint | null; value: Prisma.Decimal | null }[]>`
        SELECT COUNT(*) FILTER (WHERE s.quantity > 0) AS products,
               COALESCE(SUM(s.quantity), 0) AS units,
               COALESCE(SUM(s.quantity * p."costPrice"), 0) AS value
        FROM stocks s JOIN products p ON p.id = s."productId"
        WHERE s."warehouseId" = ${params.id}::uuid AND p."deletedAt" IS NULL`;
      return {
        ...warehouse,
        summary: { totalProducts: Number(row?.products ?? 0), totalUnits: Number(row?.units ?? 0), totalValue: String(row?.value ?? '0') },
      };
    },
  )
  .post('/', { summary: 'Crear almacén', role: 'MANAGER', body: WarehouseBody, response: WarehouseOut, status: 201 }, async ({ req, body }) => {
    const t = tenant(req);
    await assertBranch(t, body.branchId);
    const warehouse = await prisma.warehouse.create({ data: { ...body, companyId: t.companyId }, include });
    await audit(req, { action: 'CREATE', entity: 'Warehouse', entityId: warehouse.id, changes: body });
    return warehouse;
  })
  .patch(
    '/:id',
    { summary: 'Actualizar almacén', role: 'MANAGER', params: IdParams, body: WarehouseBody.partial(), response: WarehouseOut },
    async ({ req, params, body }) => {
      const t = tenant(req);
      await findWarehouse(t, params.id);
      await assertBranch(t, body.branchId);
      const warehouse = await prisma.warehouse.update({ where: { id: params.id }, data: body, include });
      await audit(req, { action: 'UPDATE', entity: 'Warehouse', entityId: warehouse.id, changes: body });
      return warehouse;
    },
  )
  .delete(
    '/:id',
    { summary: 'Eliminar almacén', description: 'Solo si nunca tuvo movimientos ni órdenes; en otro caso desactívelo.', role: 'ADMIN', params: IdParams },
    async ({ req, params }) => {
      await findWarehouse(tenant(req), params.id);
      const [movements, po, so] = await Promise.all([
        prisma.stockMovement.count({ where: { warehouseId: params.id } }),
        prisma.purchaseOrder.count({ where: { warehouseId: params.id } }),
        prisma.salesOrder.count({ where: { warehouseId: params.id } }),
      ]);
      if (movements + po + so > 0) throw Conflict('El almacén tiene historial de movimientos u órdenes. Desactívelo en su lugar.');
      await prisma.warehouse.delete({ where: { id: params.id } });
      await audit(req, { action: 'DELETE', entity: 'Warehouse', entityId: params.id });
    },
  );
