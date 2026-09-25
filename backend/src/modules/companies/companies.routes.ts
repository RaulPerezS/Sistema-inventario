import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery, QueryBool } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { hashPassword } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { tenant } from '../../lib/tenant.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { Password } from '../users/users.schemas.js';
import { CompanyFields, CompanyOut } from './companies.schemas.js';

const counts = { _count: { select: { branches: true, memberships: true, warehouses: true } } } as const;

const CreateCompanyBody = z
  .object({
    ...CompanyFields,
    isActive: z.boolean().default(true),
    branch: z
      .object({ code: z.string().trim().toUpperCase().min(1).max(20), name: z.string().trim().min(2).max(120) })
      .default({ code: 'MATRIZ', name: 'Casa Matriz' })
      .openapi({ description: 'Primera sucursal (por defecto "Casa Matriz")' }),
    admin: z
      .object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(2).max(120), password: Password.optional() })
      .optional()
      .openapi({ description: 'Administrador inicial de la empresa (si el correo ya existe, se le da acceso)' }),
  })
  .openapi('CreateCompany');

/** Administración de empresas: exclusivo del administrador de la plataforma. */
export const companiesRouter = new ApiRouter('/companies', 'Empresas (plataforma)')
  .get(
    '/',
    { summary: 'Listar empresas', role: 'superadmin', query: PaginationQuery.extend({ isActive: QueryBool.optional() }), response: paginatedOf(CompanyOut) },
    async ({ query }) => {
      const where: Prisma.CompanyWhereInput = {
        isActive: query.isActive,
        ...(query.search && {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { tradeName: { contains: query.search, mode: 'insensitive' } },
            { rut: { contains: query.search.replace(/\./g, ''), mode: 'insensitive' } },
          ],
        }),
      };
      const [data, total] = await Promise.all([
        prisma.company.findMany({ where, include: counts, orderBy: orderArgs(query, ['name', 'createdAt'], 'name'), ...pageArgs(query) }),
        prisma.company.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .get('/:id', { summary: 'Obtener empresa', role: 'superadmin', params: IdParams, response: CompanyOut }, async ({ params }) => {
    const company = await prisma.company.findUnique({ where: { id: params.id }, include: counts });
    if (!company) throw NotFound('Empresa');
    return company;
  })
  .post(
    '/',
    { summary: 'Crear empresa', description: 'Crea la empresa, su primera sucursal y (opcionalmente) su administrador.', role: 'superadmin', body: CreateCompanyBody, response: CompanyOut, status: 201 },
    async ({ req, body }) => {
      const { branch, admin, ...data } = body;
      const company = await prisma.$transaction(async (tx) => {
        const created = await tx.company.create({ data });
        await tx.branch.create({ data: { ...branch, companyId: created.id } });
        if (admin) {
          let user = await tx.user.findUnique({ where: { email: admin.email } });
          if (!user) {
            if (!admin.password) throw BadRequest('La contraseña del administrador es obligatoria para un usuario nuevo');
            user = await tx.user.create({ data: { email: admin.email, name: admin.name, passwordHash: await hashPassword(admin.password) } });
          }
          await tx.membership.create({ data: { userId: user.id, companyId: created.id, role: 'ADMIN' } });
        }
        return tx.company.findUniqueOrThrow({ where: { id: created.id }, include: counts });
      });
      await audit(req, { action: 'CREATE', entity: 'Company', entityId: company.id, changes: { ...data, branch, admin: admin?.email } });
      return company;
    },
  )
  .patch(
    '/:id',
    { summary: 'Actualizar empresa', role: 'superadmin', params: IdParams, body: z.object({ ...CompanyFields, isActive: z.boolean() }).partial(), response: CompanyOut },
    async ({ req, params, body }) => {
      const company = await prisma.company.update({ where: { id: params.id }, data: body, include: counts });
      await audit(req, { action: 'UPDATE', entity: 'Company', entityId: params.id, changes: body });
      return company;
    },
  );

const CurrentCompanyBody = z.object(CompanyFields).omit({ rut: true }).partial().openapi('UpdateCurrentCompany');

/** Datos de la empresa activa (visibles para todos; editables por su administrador). */
export const currentCompanyRouter = new ApiRouter('/company', 'Empresa actual')
  .get('/', { summary: 'Datos de la empresa activa', role: 'VIEWER', response: CompanyOut }, async ({ req }) =>
    prisma.company.findUniqueOrThrow({ where: { id: tenant(req).companyId }, include: counts }),
  )
  .patch(
    '/',
    { summary: 'Actualizar datos de la empresa activa', description: 'El RUT solo lo cambia el administrador de la plataforma.', role: 'ADMIN', body: CurrentCompanyBody, response: CompanyOut },
    async ({ req, body }) => {
      const company = await prisma.company.update({ where: { id: tenant(req).companyId }, data: body, include: counts });
      await audit(req, { action: 'UPDATE', entity: 'Company', entityId: company.id, changes: body });
      return company;
    },
  );
