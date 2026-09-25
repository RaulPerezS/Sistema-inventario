import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { hashPassword } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { CreateUserBody, ListUsersQuery, UpdateUserBody, UserOut, userSelect } from './users.schemas.js';

export const usersRouter = new ApiRouter('/users', 'Usuarios')
  .get('/', { summary: 'Listar usuarios', role: 'ADMIN', query: ListUsersQuery, response: paginatedOf(UserOut) }, async ({ query }) => {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      isActive: query.isActive,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: orderArgs(query, ['name', 'email', 'createdAt', 'role'], 'createdAt'), ...pageArgs(query) }),
      prisma.user.count({ where }),
    ]);
    return paginated(data, total, query);
  })
  .get('/:id', { summary: 'Obtener usuario', role: 'ADMIN', params: IdParams, response: UserOut }, async ({ params }) => {
    const user = await prisma.user.findUnique({ where: { id: params.id }, select: userSelect });
    if (!user) throw NotFound('Usuario');
    return user;
  })
  .post('/', { summary: 'Crear usuario', role: 'ADMIN', body: CreateUserBody, response: UserOut, status: 201 }, async ({ req, body }) => {
    const { password, ...data } = body;
    const user = await prisma.user.create({ data: { ...data, passwordHash: await hashPassword(password) }, select: userSelect });
    await audit(req, { action: 'CREATE', entity: 'User', entityId: user.id, changes: data });
    return user;
  })
  .patch('/:id', { summary: 'Actualizar usuario', role: 'ADMIN', params: IdParams, body: UpdateUserBody, response: UserOut }, async ({ req, params, body }) => {
    if (params.id === req.auth?.userId && (body.isActive === false || (body.role && body.role !== 'ADMIN'))) {
      throw BadRequest('No puede desactivarse ni quitarse el rol de administrador a sí mismo');
    }
    const { password, ...data } = body;
    const user = await prisma.user.update({
      where: { id: params.id },
      data: { ...data, ...(password && { passwordHash: await hashPassword(password) }) },
      select: userSelect,
    });
    if (password || body.isActive === false) {
      await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(req, { action: 'UPDATE', entity: 'User', entityId: user.id, changes: { ...data, passwordChanged: Boolean(password) } });
    return user;
  })
  .delete('/:id', { summary: 'Desactivar usuario', description: 'Borrado lógico: el usuario queda inactivo y se cierran sus sesiones.', role: 'ADMIN', params: IdParams }, async ({ req, params }) => {
    if (params.id === req.auth?.userId) throw BadRequest('No puede desactivarse a sí mismo');
    await prisma.$transaction([
      prisma.user.update({ where: { id: params.id }, data: { isActive: false } }),
      prisma.refreshToken.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'DELETE', entity: 'User', entityId: params.id });
  });
