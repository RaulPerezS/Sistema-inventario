import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma, type Tx } from '../../lib/prisma.js';
import { DateFrom, DateTo, DecimalOut, IdParams, Money, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { nextNumber } from '../../lib/sequence.js';
import { Conflict, NotFound, Unprocessable } from '../../lib/errors.js';
import { applyStockChange, inTransaction } from '../inventory/inventory.service.js';
import { assertActiveRefs, loadOrderProducts, orderTotal, transition } from '../_shared/orders.js';

const StatusEnum = z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).openapi('SalesOrderStatus');

const SalesOrderOut = z
  .object({
    id: z.string().uuid(),
    number: z.string().openapi({ example: 'OV-000001' }),
    status: StatusEnum,
    notes: z.string().nullable(),
    total: DecimalOut,
    customer: z.object({ id: z.string(), name: z.string() }).nullable(),
    warehouse: z.object({ id: z.string(), code: z.string(), name: z.string() }),
    createdBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    confirmedAt: z.string().datetime().nullable(),
    fulfilledAt: z.string().datetime().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    items: z.array(
      z.object({
        id: z.string().uuid(),
        productId: z.string().uuid(),
        quantity: z.number().int(),
        unitPrice: DecimalOut,
        product: z.object({ id: z.string(), sku: z.string(), name: z.string(), unit: z.string() }),
      }),
    ),
    ...Timestamps,
  })
  .openapi('SalesOrder');

const OrderBody = z
  .object({
    customerId: z.string().uuid().nullish(),
    warehouseId: z.string().uuid(),
    notes: optionalText(1000),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.coerce.number().int().positive(),
          unitPrice: Money.optional().openapi({ description: 'Por defecto, el precio de venta del producto' }),
        }),
      )
      .min(1)
      .max(500),
  })
  .openapi('SalesOrderInput');

const ListQuery = PaginationQuery.extend({
  status: StatusEnum.optional(),
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  from: DateFrom.optional(),
  to: DateTo.optional(),
});

const include = {
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
} as const;

async function findOrder(id: string) {
  const order = await prisma.salesOrder.findUnique({ where: { id }, include });
  if (!order) throw NotFound('Orden de venta');
  return order;
}

async function buildItems(tx: Tx, body: z.infer<typeof OrderBody>) {
  await assertActiveRefs(tx, { warehouseId: body.warehouseId, customerId: body.customerId });
  const products = await loadOrderProducts(tx, body.items.map((i) => i.productId));
  const items = body.items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    unitPrice: new Prisma.Decimal(i.unitPrice ?? products.get(i.productId)!.salePrice),
  }));
  return { items, total: orderTotal(items.map((i) => ({ quantity: i.quantity, price: i.unitPrice }))) };
}

/** Verifica disponibilidad de todos los ítems y reporta todos los faltantes a la vez. */
async function assertAvailability(tx: Tx, warehouseId: string, items: { productId: string; quantity: number; product?: { sku: string } }[]) {
  const stocks = await tx.stock.findMany({ where: { warehouseId, productId: { in: items.map((i) => i.productId) } } });
  const available = new Map(stocks.map((s) => [s.productId, s.quantity]));
  const shortages = items
    .filter((i) => (available.get(i.productId) ?? 0) < i.quantity)
    .map((i) => ({ productId: i.productId, sku: i.product?.sku, requested: i.quantity, available: available.get(i.productId) ?? 0 }));
  if (shortages.length) throw Unprocessable('Stock insuficiente para uno o más productos', { shortages });
}

export const salesOrdersRouter = new ApiRouter('/sales-orders', 'Órdenes de venta')
  .get('/', { summary: 'Listar órdenes de venta', role: 'VIEWER', query: ListQuery, response: paginatedOf(SalesOrderOut) }, async ({ query }) => {
    const where: Prisma.SalesOrderWhereInput = {
      status: query.status,
      customerId: query.customerId,
      warehouseId: query.warehouseId,
      ...((query.from || query.to) && { createdAt: { gte: query.from, lte: query.to } }),
      ...(query.search && {
        OR: [
          { number: { contains: query.search, mode: 'insensitive' } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      prisma.salesOrder.findMany({ where, include, orderBy: orderArgs(query, ['createdAt', 'number', 'total'], 'createdAt'), ...pageArgs(query) }),
      prisma.salesOrder.count({ where }),
    ]);
    return paginated(data, total, query);
  })
  .get('/:id', { summary: 'Obtener orden de venta', role: 'VIEWER', params: IdParams, response: SalesOrderOut }, ({ params }) => findOrder(params.id))
  .post('/', { summary: 'Crear orden de venta (borrador)', role: 'OPERATOR', body: OrderBody, response: SalesOrderOut, status: 201 }, async ({ req, body }) => {
    const id = await inTransaction(async (tx) => {
      const { items, total } = await buildItems(tx, body);
      const order = await tx.salesOrder.create({
        data: {
          number: await nextNumber(tx, 'sales_order', 'OV'),
          customerId: body.customerId,
          warehouseId: body.warehouseId,
          notes: body.notes,
          createdById: req.auth?.userId,
          total,
          items: { create: items },
        },
      });
      return order.id;
    });
    await audit(req, { action: 'CREATE', entity: 'SalesOrder', entityId: id, changes: body });
    return findOrder(id);
  })
  .put(
    '/:id',
    { summary: 'Reemplazar orden (solo en borrador)', role: 'OPERATOR', params: IdParams, body: OrderBody, response: SalesOrderOut },
    async ({ req, params, body }) => {
      await inTransaction(async (tx) => {
        const order = await tx.salesOrder.findUnique({ where: { id: params.id } });
        if (!order) throw NotFound('Orden de venta');
        if (order.status !== 'DRAFT') throw Conflict('Solo se pueden editar órdenes en borrador');
        const { items, total } = await buildItems(tx, body);
        await tx.salesOrderItem.deleteMany({ where: { salesOrderId: order.id } });
        await tx.salesOrder.update({
          where: { id: order.id },
          data: { customerId: body.customerId ?? null, warehouseId: body.warehouseId, notes: body.notes, total, items: { create: items } },
        });
      });
      await audit(req, { action: 'UPDATE', entity: 'SalesOrder', entityId: params.id, changes: body });
      return findOrder(params.id);
    },
  )
  .post(
    '/:id/confirm',
    { summary: 'Confirmar orden', description: 'Valida disponibilidad de stock. DRAFT → CONFIRMED', role: 'OPERATOR', params: IdParams, response: SalesOrderOut },
    async ({ req, params }) => {
      const order = await findOrder(params.id);
      await inTransaction(async (tx) => {
        await assertAvailability(tx, order.warehouseId, order.items);
        await transition((a) => tx.salesOrder.updateMany(a), params.id, ['DRAFT'], { status: 'CONFIRMED', confirmedAt: new Date() }, 'confirmar');
      });
      await audit(req, { action: 'CONFIRM', entity: 'SalesOrder', entityId: params.id });
      return findOrder(params.id);
    },
  )
  .post(
    '/:id/fulfill',
    { summary: 'Despachar orden', description: 'Descuenta stock (movimientos SALE). CONFIRMED → FULFILLED', role: 'OPERATOR', params: IdParams, response: SalesOrderOut },
    async ({ req, params }) => {
      const order = await findOrder(params.id);
      await inTransaction(async (tx) => {
        await transition((a) => tx.salesOrder.updateMany(a), params.id, ['CONFIRMED'], { status: 'FULFILLED', fulfilledAt: new Date() }, 'despachar');
        await assertAvailability(tx, order.warehouseId, order.items);
        for (const item of order.items) {
          await applyStockChange(tx, {
            type: 'SALE',
            productId: item.productId,
            warehouseId: order.warehouseId,
            delta: -item.quantity,
            reference: order.number,
            userId: req.auth?.userId,
            salesOrderId: order.id,
          });
        }
      });
      await audit(req, { action: 'FULFILL', entity: 'SalesOrder', entityId: params.id });
      return findOrder(params.id);
    },
  )
  .post('/:id/cancel', { summary: 'Cancelar orden', description: 'Solo DRAFT o CONFIRMED.', role: 'OPERATOR', params: IdParams, response: SalesOrderOut }, async ({ req, params }) => {
    await findOrder(params.id);
    await transition((a) => prisma.salesOrder.updateMany(a), params.id, ['DRAFT', 'CONFIRMED'], { status: 'CANCELLED', cancelledAt: new Date() }, 'cancelar');
    await audit(req, { action: 'CANCEL', entity: 'SalesOrder', entityId: params.id });
    return findOrder(params.id);
  })
  .delete('/:id', { summary: 'Eliminar orden en borrador', role: 'MANAGER', params: IdParams }, async ({ req, params }) => {
    const { count } = await prisma.salesOrder.deleteMany({ where: { id: params.id, status: 'DRAFT' } });
    if (count === 0) {
      await findOrder(params.id);
      throw Conflict('Solo se pueden eliminar órdenes en borrador');
    }
    await audit(req, { action: 'DELETE', entity: 'SalesOrder', entityId: params.id });
  });
