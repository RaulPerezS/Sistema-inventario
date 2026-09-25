import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams } from '../../lib/common-schemas.js';
import { pageArgs, paginated, PaginationQuery } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { randomToken } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import { emit, WEBHOOK_EVENTS } from '../../lib/webhooks.js';

const EventEnum = z.enum(['*', ...WEBHOOK_EVENTS]).openapi('WebhookEvent');

const WebhookOut = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    stats: z.object({ pending: z.number(), success: z.number(), failed: z.number() }),
  })
  .openapi('Webhook');

const WebhookBody = z
  .object({
    name: z.string().trim().min(2).max(100).openapi({ example: 'ERP contable' }),
    url: z
      .string()
      .trim()
      .url()
      .refine((u) => /^https?:\/\//i.test(u), 'La URL debe usar http o https')
      .openapi({ example: 'https://erp.miempresa.cl/webhooks/inventario' }),
    events: z.array(EventEnum).min(1).openapi({ description: 'Eventos a recibir; "*" para todos' }),
    isActive: z.boolean().default(true),
  })
  .openapi('WebhookInput');

const DeliveryOut = z
  .object({
    id: z.string().uuid(),
    event: z.string(),
    status: z.enum(['PENDING', 'SUCCESS', 'FAILED']),
    attempts: z.number(),
    responseStatus: z.number().nullable(),
    error: z.string().nullable(),
    payload: z.any(),
    nextAttemptAt: z.string().datetime(),
    deliveredAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('WebhookDelivery');

const select = { id: true, name: true, url: true, events: true, isActive: true, createdAt: true, updatedAt: true } as const;

async function withStats<T extends { id: string }>(hooks: T[]) {
  const counts = await prisma.webhookDelivery.groupBy({ by: ['webhookId', 'status'], where: { webhookId: { in: hooks.map((h) => h.id) } }, _count: true });
  return hooks.map((h) => {
    const c = (status: string) => counts.find((x) => x.webhookId === h.id && x.status === status)?._count ?? 0;
    return { ...h, stats: { pending: c('PENDING'), success: c('SUCCESS'), failed: c('FAILED') } };
  });
}

async function findHook(id: string) {
  const hook = await prisma.webhook.findUnique({ where: { id }, select });
  if (!hook) throw NotFound('Webhook');
  return (await withStats([hook]))[0]!;
}

const SIGNATURE_DOC = [
  'Cada envío es un `POST` JSON `{ id, event, createdAt, data }` con las cabeceras',
  '`X-Webhook-Event`, `X-Webhook-Id`, `X-Webhook-Timestamp` y',
  '`X-Webhook-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`.',
  'Responda 2xx para confirmar; si no, se reintenta con espera exponencial (hasta 6 intentos).',
].join(' ');

export const webhooksRouter = new ApiRouter('/webhooks', 'Webhooks')
  .get('/events', { summary: 'Eventos disponibles', role: 'ADMIN', response: z.array(z.string()) }, () => [...WEBHOOK_EVENTS])
  .get('/', { summary: 'Listar webhooks', description: SIGNATURE_DOC, role: 'ADMIN', response: z.array(WebhookOut) }, async () =>
    withStats(await prisma.webhook.findMany({ select, orderBy: { createdAt: 'desc' } })),
  )
  .get('/:id', { summary: 'Obtener webhook', role: 'ADMIN', params: IdParams, response: WebhookOut }, ({ params }) => findHook(params.id))
  .post(
    '/',
    {
      summary: 'Crear webhook',
      description: 'El `secret` para verificar las firmas se devuelve **una sola vez**. ' + SIGNATURE_DOC,
      role: 'ADMIN',
      body: WebhookBody,
      response: WebhookOut.extend({ secret: z.string() }),
      status: 201,
    },
    async ({ req, body }) => {
      const secret = `whsec_${randomToken(24)}`;
      const hook = await prisma.webhook.create({ data: { ...body, secret, createdById: req.auth?.userId }, select });
      await audit(req, { action: 'CREATE', entity: 'Webhook', entityId: hook.id, changes: body });
      return { ...(await findHook(hook.id)), secret };
    },
  )
  .patch('/:id', { summary: 'Actualizar webhook', role: 'ADMIN', params: IdParams, body: WebhookBody.partial(), response: WebhookOut }, async ({ req, params, body }) => {
    await prisma.webhook.update({ where: { id: params.id }, data: body });
    await audit(req, { action: 'UPDATE', entity: 'Webhook', entityId: params.id, changes: body });
    return findHook(params.id);
  })
  .delete('/:id', { summary: 'Eliminar webhook', role: 'ADMIN', params: IdParams }, async ({ req, params }) => {
    await prisma.webhook.delete({ where: { id: params.id } });
    await audit(req, { action: 'DELETE', entity: 'Webhook', entityId: params.id });
  })
  .post(
    '/:id/rotate-secret',
    { summary: 'Regenerar el secreto de firma', role: 'ADMIN', params: IdParams, response: z.object({ secret: z.string() }) },
    async ({ req, params }) => {
      const secret = `whsec_${randomToken(24)}`;
      await prisma.webhook.update({ where: { id: params.id }, data: { secret } });
      await audit(req, { action: 'ROTATE_SECRET', entity: 'Webhook', entityId: params.id });
      return { secret };
    },
  )
  .post(
    '/:id/test',
    { summary: 'Enviar un evento de prueba', description: 'Encola un evento `webhook.test` solo para este webhook.', role: 'ADMIN', params: IdParams, status: 202, response: z.object({ queued: z.boolean() }) },
    async ({ params }) => {
      await findHook(params.id);
      await emit('webhook.test', { message: 'Evento de prueba del Sistema de Inventario', sentAt: new Date().toISOString() }, params.id);
      return { queued: true };
    },
  )
  .get(
    '/:id/deliveries',
    {
      summary: 'Historial de envíos',
      role: 'ADMIN',
      params: IdParams,
      query: PaginationQuery.pick({ page: true, limit: true }).extend({ status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional() }),
      response: paginatedOf(DeliveryOut),
    },
    async ({ params, query }) => {
      const where: Prisma.WebhookDeliveryWhereInput = { webhookId: params.id, status: query.status };
      const [data, total] = await Promise.all([
        prisma.webhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
        prisma.webhookDelivery.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .post(
    '/deliveries/:id/retry',
    { summary: 'Reintentar un envío', role: 'ADMIN', params: IdParams, response: DeliveryOut },
    async ({ req, params }) => {
      const delivery = await prisma.webhookDelivery.update({
        where: { id: params.id },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), error: null },
      });
      await audit(req, { action: 'RETRY', entity: 'WebhookDelivery', entityId: params.id });
      return delivery;
    },
  );
