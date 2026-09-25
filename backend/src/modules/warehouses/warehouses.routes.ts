import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery, QueryBool } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { Conflict, NotFound } from '../../lib/errors.js';

const WarehouseOut = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    isActive: z.boolean(),
    ...Timestamps,
  })
  .openapi('Warehouse');

const WarehouseBody = z
  .object({
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

export const warehousesRouter = new ApiRouter('/warehouses', 'Almacenes')
  .get(
    '/',
    { summary: 'Listar almacenes', role: 'VIEWER', query: PaginationQuery.extend({ isActive: QueryBool.optional() }), response: paginatedOf(WarehouseOut) },
    async ({ query }) => {
      const where: Prisma.WarehouseWhereInput = {
        isActive: query.isActive,
        ...(query.search && {
          OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }],
        }),
      };
      const [data, total] = await Promise.all([
        prisma.warehouse.findMany({ where, orderBy: orderArgs(query, ['code', 'name', 'createdAt'], 'code'), ...pageArgs(query) }),
        prisma.warehouse.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .get(
    '/:id',
    { summary: 'Obtener almacén con resumen de existencias', role: 'VIEWER', params: IdParams, response: WarehouseOut.extend({ summary: WarehouseSummary }) },
    async ({ params }) => {
      const warehouse = await prisma.warehouse.findUnique({ where: { id: params.id } });
      if (!warehouse) throw NotFound('Almacén');
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
    const warehouse = await prisma.warehouse.create({ data: body });
    await audit(req, { action: 'CREATE', entity: 'Warehouse', entityId: warehouse.id, changes: body });
    return warehouse;
  })
  .patch(
    '/:id',
    { summary: 'Actualizar almacén', role: 'MANAGER', params: IdParams, body: WarehouseBody.partial(), response: WarehouseOut },
    async ({ req, params, body }) => {
      const warehouse = await prisma.warehouse.update({ where: { id: params.id }, data: body });
      await audit(req, { action: 'UPDATE', entity: 'Warehouse', entityId: warehouse.id, changes: body });
      return warehouse;
    },
  )
  .delete(
    '/:id',
    { summary: 'Eliminar almacén', description: 'Solo si nunca tuvo movimientos ni órdenes; en otro caso desactívelo.', role: 'ADMIN', params: IdParams },
    async ({ req, params }) => {
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
