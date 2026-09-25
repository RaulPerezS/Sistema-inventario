import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma } from '../../lib/prisma.js';
import { IdParams } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { requireUser } from '../../middleware/auth.js';
import { RoleEnum } from '../users/users.schemas.js';
import { tenant } from '../../lib/tenant.js';

const ApiKeyOut = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    prefix: z.string().openapi({ description: 'Primeros caracteres de la clave, para identificarla' }),
    role: RoleEnum,
    branchIds: z.array(z.string().uuid()).openapi({ description: 'Sucursales permitidas; vacío = todas' }),
    lastUsedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    createdBy: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  })
  .openapi('ApiKey');

const CreateApiKeyBody = z
  .object({
    name: z.string().trim().min(2).max(100).openapi({ example: 'ERP Contable' }),
    role: RoleEnum.exclude(['ADMIN']).default('VIEWER').openapi({ description: 'Permisos de la clave (no puede ser ADMIN)' }),
    branchIds: z.array(z.string().uuid()).default([]).openapi({ description: 'Restringir a estas sucursales (vacío = todas)' }),
    expiresAt: z.coerce.date().optional().openapi({ type: 'string', format: 'date-time' }),
  })
  .openapi('CreateApiKey');

const select = {
  id: true,
  name: true,
  prefix: true,
  role: true,
  branchIds: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

export const apiKeysRouter = new ApiRouter('/api-keys', 'API Keys')
  .get('/', { summary: 'Listar API keys', role: 'ADMIN', query: PaginationQuery, response: paginatedOf(ApiKeyOut) }, async ({ req, query }) => {
    const where = { companyId: tenant(req).companyId, ...(query.search && { name: { contains: query.search, mode: 'insensitive' as const } }) };
    const [data, total] = await Promise.all([
      prisma.apiKey.findMany({ where, select, orderBy: orderArgs(query, ['name', 'createdAt', 'lastUsedAt'], 'createdAt'), ...pageArgs(query) }),
      prisma.apiKey.count({ where }),
    ]);
    return paginated(data, total, query);
  })
  .post(
    '/',
    {
      summary: 'Crear API key',
      description: 'La clave completa se devuelve **una sola vez** en el campo `key`. Guárdela de forma segura.',
      role: 'ADMIN',
      body: CreateApiKeyBody,
      response: ApiKeyOut.extend({ key: z.string().openapi({ example: 'inv_3f9a...' }) }),
      status: 201,
      middlewares: [requireUser],
    },
    async ({ req, body }) => {
      if (body.expiresAt && body.expiresAt <= new Date()) throw BadRequest('La fecha de expiración debe ser futura');
      const { companyId } = tenant(req);
      if (body.branchIds.length && (await prisma.branch.count({ where: { companyId, id: { in: body.branchIds } } })) !== new Set(body.branchIds).size) {
        throw BadRequest('Alguna de las sucursales no pertenece a la empresa');
      }
      const key = `inv_${randomToken(32)}`;
      const created = await prisma.apiKey.create({
        data: {
          companyId,
          name: body.name,
          role: body.role,
          branchIds: body.branchIds,
          expiresAt: body.expiresAt,
          prefix: key.slice(0, 12),
          keyHash: sha256(key),
          createdById: req.auth!.userId!,
        },
        select,
      });
      await audit(req, { action: 'CREATE', entity: 'ApiKey', entityId: created.id, changes: { name: body.name, role: body.role } });
      return { ...created, key };
    },
  )
  .delete('/:id', { summary: 'Revocar API key', role: 'ADMIN', params: IdParams }, async ({ req, params }) => {
    const key = await prisma.apiKey.findFirst({ where: { id: params.id, companyId: tenant(req).companyId } });
    if (!key) throw NotFound('API key');
    if (!key.revokedAt) await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'REVOKE', entity: 'ApiKey', entityId: key.id });
  });
