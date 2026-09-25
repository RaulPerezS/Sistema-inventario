import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery, QueryBool } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { tenant } from '../../lib/tenant.js';
import { Conflict, NotFound } from '../../lib/errors.js';

const BranchOut = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    phone: z.string().nullable(),
    isActive: z.boolean(),
    _count: z.object({ warehouses: z.number() }),
    ...Timestamps,
  })
  .openapi('Branch');

const BranchBody = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(20)
      .regex(/^[A-Z0-9_-]+$/, 'Solo letras, números, guion y guion bajo')
      .openapi({ example: 'STGO-CENTRO' }),
    name: z.string().trim().min(2).max(120).openapi({ example: 'Santiago Centro' }),
    address: optionalText(300),
    city: optionalText(100),
    phone: optionalText(40),
    isActive: z.boolean().default(true),
  })
  .openapi('BranchInput');

const include = { _count: { select: { warehouses: true } } } as const;

export const branchesRouter = new ApiRouter('/branches', 'Sucursales')
  .get(
    '/',
    {
      summary: 'Listar sucursales',
      description: 'Si el usuario está restringido a ciertas sucursales, solo ve esas.',
      role: 'VIEWER',
      query: PaginationQuery.extend({ isActive: QueryBool.optional() }),
      response: paginatedOf(BranchOut),
    },
    async ({ req, query }) => {
      const t = tenant(req);
      const where: Prisma.BranchWhereInput = {
        companyId: t.companyId,
        isActive: query.isActive,
        ...(t.branchIds && { id: { in: t.branchIds } }),
        ...(query.search && {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
            { city: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      };
      const [data, total] = await Promise.all([
        prisma.branch.findMany({ where, include, orderBy: orderArgs(query, ['code', 'name', 'createdAt'], 'name'), ...pageArgs(query) }),
        prisma.branch.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .get('/:id', { summary: 'Obtener sucursal', role: 'VIEWER', params: IdParams, response: BranchOut }, async ({ req, params }) => {
    const t = tenant(req);
    const branch = await prisma.branch.findFirst({ where: { id: params.id, companyId: t.companyId, ...(t.branchIds && { id: { in: t.branchIds } }) }, include });
    if (!branch) throw NotFound('Sucursal');
    return branch;
  })
  .post('/', { summary: 'Crear sucursal', role: 'ADMIN', body: BranchBody, response: BranchOut, status: 201 }, async ({ req, body }) => {
    const branch = await prisma.branch.create({ data: { ...body, companyId: tenant(req).companyId }, include });
    await audit(req, { action: 'CREATE', entity: 'Branch', entityId: branch.id, changes: body });
    return branch;
  })
  .patch('/:id', { summary: 'Actualizar sucursal', role: 'ADMIN', params: IdParams, body: BranchBody.partial(), response: BranchOut }, async ({ req, params, body }) => {
    const { count } = await prisma.branch.updateMany({ where: { id: params.id, companyId: tenant(req).companyId }, data: body });
    if (!count) throw NotFound('Sucursal');
    await audit(req, { action: 'UPDATE', entity: 'Branch', entityId: params.id, changes: body });
    return prisma.branch.findUniqueOrThrow({ where: { id: params.id }, include });
  })
  .delete('/:id', { summary: 'Eliminar sucursal', description: 'Solo si no tiene almacenes; en otro caso desactívela.', role: 'ADMIN', params: IdParams }, async ({ req, params }) => {
    const branch = await prisma.branch.findFirst({ where: { id: params.id, companyId: tenant(req).companyId }, include });
    if (!branch) throw NotFound('Sucursal');
    if (branch._count.warehouses > 0) throw Conflict('La sucursal tiene almacenes asociados. Desactívela en su lugar.');
    await prisma.branch.delete({ where: { id: branch.id } });
    await audit(req, { action: 'DELETE', entity: 'Branch', entityId: branch.id });
  });
