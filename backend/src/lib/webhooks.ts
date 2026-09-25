import { createHmac } from 'node:crypto';
import { prisma, Prisma } from './prisma.js';
import { logger } from './logger.js';

/** Eventos que pueden suscribir los sistemas externos. */
export const WEBHOOK_EVENTS = [
  'inventory.movements.created',
  'inventory.low_stock',
  'product.created',
  'product.updated',
  'product.deleted',
  'purchase_order.created',
  'purchase_order.status_changed',
  'sales_order.created',
  'sales_order.status_changed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'webhook.test';

export const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 10_000;
/** Espera antes del reintento n (1-indexado): 30 s, 1 min, 2 min, 4 min, 8 min. */
export const retryDelayMs = (attempt: number) => 30_000 * 2 ** (attempt - 1);

export function sign(secret: string, timestamp: number, body: string) {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

const toJson = (data: unknown) => JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;

/**
 * Encola el evento para cada webhook activo suscrito. Debe llamarse después de confirmar
 * la transacción para no notificar cambios que finalmente se revirtieron. Nunca lanza.
 */
export async function emit(event: WebhookEvent, data: unknown, onlyWebhookId?: string): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({
      where: onlyWebhookId ? { id: onlyWebhookId } : { isActive: true, OR: [{ events: { has: event } }, { events: { has: '*' } }] },
      select: { id: true },
    });
    if (hooks.length === 0) return;
    await prisma.webhookDelivery.createMany({
      data: hooks.map((h) => ({ webhookId: h.id, event, payload: toJson(data) })),
    });
    kick();
  } catch (err) {
    logger.error({ err, event }, 'No se pudo encolar el webhook');
  }
}

/** Intenta un envío y actualiza su estado. */
async function deliver(id: string) {
  const d = await prisma.webhookDelivery.findUnique({ where: { id }, include: { webhook: true } });
  if (!d || d.status !== 'PENDING') return;

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: d.id, event: d.event, createdAt: d.createdAt.toISOString(), data: d.payload });
  const attempts = d.attempts + 1;
  let responseStatus: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(d.webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Inventario-Webhooks/1.0',
        'X-Webhook-Id': d.id,
        'X-Webhook-Event': d.event,
        'X-Webhook-Timestamp': String(timestamp),
        'X-Webhook-Signature': sign(d.webhook.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    });
    responseStatus = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ok = error === null;
  await prisma.webhookDelivery.update({
    where: { id: d.id },
    data: {
      attempts,
      responseStatus,
      error,
      status: ok ? 'SUCCESS' : attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
      deliveredAt: ok ? new Date() : null,
      nextAttemptAt: ok ? d.nextAttemptAt : new Date(Date.now() + retryDelayMs(attempts)),
    },
  });
}

/**
 * Procesa los envíos pendientes cuyo turno llegó. Usa `FOR UPDATE SKIP LOCKED` para que
 * varias instancias de la API puedan trabajar en paralelo sin enviar dos veces.
 */
export async function processDueDeliveries(limit = 20): Promise<number> {
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE webhook_deliveries SET "nextAttemptAt" = now() + interval '2 minutes'
    WHERE id IN (
      SELECT id FROM webhook_deliveries
      WHERE status = 'PENDING' AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt" LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) RETURNING id`;
  await Promise.all(claimed.map((c) => deliver(c.id).catch((err) => logger.error({ err }, 'Error enviando webhook'))));
  return claimed.length;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    while ((await processDueDeliveries()) > 0);
  } catch (err) {
    logger.error({ err }, 'Worker de webhooks');
  } finally {
    running = false;
  }
}

/** Adelanta el procesamiento tras encolar (si el worker está activo). */
function kick() {
  if (timer) setImmediate(tick);
}

export function startWebhookWorker(intervalMs = 5_000) {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref();
  logger.info('Worker de webhooks iniciado');
}

export function stopWebhookWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Tras movimientos de salida, notifica los productos que quedaron en o bajo su mínimo. */
export async function notifyLowStock(productIds: string[]) {
  if (productIds.length === 0) return;
  try {
    const rows = await prisma.$queryRaw<{ id: string; sku: string; name: string; minStock: number; total: bigint }[]>`
      SELECT p.id, p.sku, p.name, p."minStock", COALESCE(SUM(s.quantity), 0) AS total
      FROM products p LEFT JOIN stocks s ON s."productId" = p.id
      WHERE p.id IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))}) AND p."deletedAt" IS NULL
      GROUP BY p.id HAVING COALESCE(SUM(s.quantity), 0) <= p."minStock"`;
    for (const r of rows) {
      await emit('inventory.low_stock', { productId: r.id, sku: r.sku, name: r.name, minStock: r.minStock, totalStock: Number(r.total) });
    }
  } catch (err) {
    logger.error({ err }, 'No se pudo evaluar stock bajo');
  }
}
