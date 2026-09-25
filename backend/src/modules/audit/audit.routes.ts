import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { DateFrom, DateTo } from '../../lib/common-schemas.js';
import { pageArgs, paginated, PaginationQuery } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { tenant } from '../../lib/tenant.js';

const AuditOut = z
  .object({
    id: z.string().uuid(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string().nullable(),
    changes: z.any(),
    ip: z.string().nullable(),
    createdAt: z.string().datetime(),
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
    apiKey: z.object({ id: z.string(), name: z.string() }).nullable(),
  })
  .openapi('AuditLog');

export const auditRouter = new ApiRouter('/audit-logs', 'Auditoría').get(
  '/',
  {
    summary: 'Bitácora de auditoría de la empresa',
    role: 'ADMIN',
    query: PaginationQuery.extend({
      entity: z.string().optional(),
      entityId: z.string().optional(),
      action: z.string().optional(),
      userId: z.string().uuid().optional(),
      from: DateFrom.optional(),
      to: DateTo.optional(),
    }),
    response: paginatedOf(AuditOut),
  },
  async ({ req, query }) => {
    const where: Prisma.AuditLogWhereInput = {
      companyId: tenant(req).companyId,
      entity: query.entity,
      entityId: query.entityId,
      action: query.action,
      userId: query.userId,
      ...((query.from || query.to) && { createdAt: { gte: query.from, lte: query.to } }),
    };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } }, apiKey: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      prisma.auditLog.count({ where }),
    ]);
    return paginated(data, total, query);
  },
);
