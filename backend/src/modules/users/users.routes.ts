import type { Request } from 'express';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams } from '../../lib/common-schemas.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { hashPassword } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { tenant } from '../../lib/tenant.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../lib/errors.js';
import { CompanyUserOut, CreateUserBody, ListUsersQuery, UpdateUserBody } from './users.schemas.js';

const include = { user: { select: { id: true, email: true, name: true, lastLoginAt: true, isActive: true, createdAt: true } } } as const;
type Row = Prisma.MembershipGetPayload<{ include: typeof include }>;

const toOut = (m: Row) => ({
  id: m.user.id,
  email: m.user.email,
  name: m.user.name,
  role: m.role,
  branchIds: m.branchIds,
  isActive: m.isActive && m.user.isActive,
  lastLoginAt: m.user.lastLoginAt,
  createdAt: m.createdAt,
});

/** Las sucursales indicadas deben pertenecer a la empresa activa. */
async function assertBranches(companyId: string, branchIds: string[] | undefined) {
  if (!branchIds?.length) return;
  const count = await prisma.branch.count({ where: { companyId, id: { in: branchIds } } });
  if (count !== new Set(branchIds).size) throw BadRequest('Alguna de las sucursales no pertenece a la empresa');
}

async function findMembership(req: Request, userId: string) {
  const { companyId } = tenant(req);
  const m = await prisma.membership.findUnique({ where: { userId_companyId: { userId, companyId } }, include });
  if (!m) throw NotFound('Usuario');
  return m;
}

/** Datos personales (nombre, contraseña) solo se editan si el usuario pertenece únicamente a esta empresa. */
async function assertOwnsIdentity(req: Request, userId: string) {
  if (req.auth?.isSuperAdmin) return;
  const others = await prisma.membership.count({ where: { userId, companyId: { not: tenant(req).companyId } } });
  if (others > 0) throw Forbidden('El usuario pertenece también a otras empresas: solo él puede cambiar sus datos personales');
}

export const usersRouter = new ApiRouter('/users', 'Usuarios')
  .get('/', { summary: 'Listar usuarios de la empresa', role: 'ADMIN', query: ListUsersQuery, response: paginatedOf(CompanyUserOut) }, async ({ req, query }) => {
    const where: Prisma.MembershipWhereInput = {
      companyId: tenant(req).companyId,
      role: query.role,
      isActive: query.isActive,
      ...(query.search && {
        user: { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] },
      }),
    };
    const [data, total] = await Promise.all([
      prisma.membership.findMany({ where, include, orderBy: { user: { name: 'asc' } }, ...pageArgs(query) }),
      prisma.membership.count({ where }),
    ]);
    return paginated(data.map(toOut), total, query);
  })
  .get('/:id', { summary: 'Obtener usuario', role: 'ADMIN', params: IdParams, response: CompanyUserOut }, async ({ req, params }) =>
    toOut(await findMembership(req, params.id)),
  )
  .post(
    '/',
    { summary: 'Agregar usuario a la empresa', role: 'ADMIN', body: CreateUserBody, response: CompanyUserOut, status: 201 },
    async ({ req, body }) => {
      const { companyId } = tenant(req);
      await assertBranches(companyId, body.branchIds);
      let user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user) {
        if (!body.password) throw BadRequest('La contraseña es obligatoria para un usuario nuevo');
        user = await prisma.user.create({ data: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) } });
      } else if (await prisma.membership.findUnique({ where: { userId_companyId: { userId: user.id, companyId } } })) {
        throw Conflict('El usuario ya pertenece a esta empresa');
      }
      const m = await prisma.membership.create({
        data: { userId: user.id, companyId, role: body.role, branchIds: body.branchIds, isActive: body.isActive },
        include,
      });
      await audit(req, { action: 'CREATE', entity: 'User', entityId: user.id, changes: { email: body.email, role: body.role, branchIds: body.branchIds } });
      return toOut(m);
    },
  )
  .patch('/:id', { summary: 'Actualizar usuario', role: 'ADMIN', params: IdParams, body: UpdateUserBody, response: CompanyUserOut }, async ({ req, params, body }) => {
    const { companyId } = tenant(req);
    const self = params.id === req.auth?.userId;
    if (self && (body.isActive === false || (body.role && body.role !== 'ADMIN'))) {
      throw BadRequest('No puede desactivarse ni quitarse el rol de administrador a sí mismo');
    }
    const current = await findMembership(req, params.id);
    await assertBranches(companyId, body.branchIds);
    const { password, ...membership } = body;
    // Un nombre idéntico al actual no cuenta como cambio de datos personales
    const name = body.name !== undefined && body.name !== current.user.name ? body.name : undefined;
    delete (membership as { name?: string }).name;
    if (name !== undefined || password) await assertOwnsIdentity(req, params.id);

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: current.id }, data: membership });
      if (name !== undefined || password) {
        await tx.user.update({ where: { id: params.id }, data: { name, ...(password && { passwordHash: await hashPassword(password) }) } });
      }
      // Cambios de acceso cierran las sesiones abiertas en esta empresa
      if (password || body.isActive === false) {
        await tx.refreshToken.updateMany({ where: { userId: params.id, revokedAt: null, ...(password ? {} : { companyId }) }, data: { revokedAt: new Date() } });
      }
    });
    await audit(req, { action: 'UPDATE', entity: 'User', entityId: params.id, changes: { ...membership, name, passwordChanged: Boolean(password) } });
    return toOut(await findMembership(req, params.id));
  })
  .delete(
    '/:id',
    { summary: 'Quitar usuario de la empresa', description: 'Elimina su acceso a esta empresa (la cuenta sigue existiendo para otras empresas).', role: 'ADMIN', params: IdParams },
    async ({ req, params }) => {
      if (params.id === req.auth?.userId) throw BadRequest('No puede quitarse a sí mismo de la empresa');
      const m = await findMembership(req, params.id);
      await prisma.$transaction([
        prisma.membership.delete({ where: { id: m.id } }),
        prisma.refreshToken.updateMany({ where: { userId: params.id, companyId: m.companyId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await audit(req, { action: 'DELETE', entity: 'User', entityId: params.id });
    },
  );
