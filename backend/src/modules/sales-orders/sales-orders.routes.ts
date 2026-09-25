import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma, type Tx } from '../../lib/prisma.js';
import { DateFrom, DateTo, DecimalOut, IdParams, Money, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { nextNumber } from '../../lib/sequence.js';
import { Conflict, NotFound } from '../../lib/errors.js';
import { applyStockChange, inTransaction, releaseReservation, reserveStock } from '../inventory/inventory.service.js';
import { assertActiveRefs, loadOrderProducts, orderTotals, taxRateFor, transition } from '../_shared/orders.js';
import { emit, notifyLowStock } from '../../lib/webhooks.js';

const StatusEnum = z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).openapi('SalesOrderStatus');

const SalesOrderOut = z
  .object({
    id: z.string().uuid(),
    number: z.string().openapi({ example: 'OV-000001' }),
    status: StatusEnum,
    notes: z.string().nullable(),
    subtotal: DecimalOut.openapi({ description: 'Neto' }),
    tax: DecimalOut.openapi({ description: 'IVA' }),
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
        unitPrice: DecimalOut.openapi({ description: 'Precio neto unitario' }),
        taxRate: DecimalOut.openapi({ description: 'Tasa de IVA aplicada (%)' }),
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
          unitPrice: Money.optional().openapi({ description: 'Precio neto. Por defecto, el precio de venta del producto' }),
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
  const items = body.items.map((i) => {
    const product = products.get(i.productId)!;
    return {
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: new Prisma.Decimal(i.unitPrice ?? product.salePrice),
      taxRate: taxRateFor(product),
    };
  });
  return { items, ...orderTotals(items.map((i) => ({ quantity: i.quantity, price: i.unitPrice, taxRate: i.taxRate }))) };
}

const statusEvent = (id: string, status: string) =>
  findOrder(id).then((order) => emit('sales_order.status_changed', { status, order }));

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
      const { items, subtotal, tax, total } = await buildItems(tx, body);
      const order = await tx.salesOrder.create({
        data: {
          number: await nextNumber(tx, 'sales_order', 'OV'),
          customerId: body.customerId,
          warehouseId: body.warehouseId,
          notes: body.notes,
          createdById: req.auth?.userId,
          subtotal,
          tax,
          total,
          items: { create: items },
        },
      });
      return order.id;
    });
    await audit(req, { action: 'CREATE', entity: 'SalesOrder', entityId: id, changes: body });
    const created = await findOrder(id);
    await emit('sales_order.created', created);
    return created;
  })
  .put(
    '/:id',
    { summary: 'Reemplazar orden (solo en borrador)', role: 'OPERATOR', params: IdParams, body: OrderBody, response: SalesOrderOut },
    async ({ req, params, body }) => {
      await inTransaction(async (tx) => {
        const order = await tx.salesOrder.findUnique({ where: { id: params.id } });
        if (!order) throw NotFound('Orden de venta');
        if (order.status !== 'DRAFT') throw Conflict('Solo se pueden editar órdenes en borrador');
        const { items, subtotal, tax, total } = await buildItems(tx, body);
        await tx.salesOrderItem.deleteMany({ where: { salesOrderId: order.id } });
        await tx.salesOrder.update({
          where: { id: order.id },
          data: { customerId: body.customerId ?? null, warehouseId: body.warehouseId, notes: body.notes, subtotal, tax, total, items: { create: items } },
        });
      });
      await audit(req, { action: 'UPDATE', entity: 'SalesOrder', entityId: params.id, changes: body });
      return findOrder(params.id);
    },
  )
  .post(
    '/:id/confirm',
    {
      summary: 'Confirmar orden',
      description: 'Reserva el stock en el almacén (deja de estar disponible para otras salidas). Falla con 422 si no alcanza. DRAFT → CONFIRMED',
      role: 'OPERATOR',
      params: IdParams,
      response: SalesOrderOut,
    },
    async ({ req, params }) => {
      const order = await findOrder(params.id);
      await inTransaction(async (tx) => {
        await transition((a) => tx.salesOrder.updateMany(a), params.id, ['DRAFT'], { status: 'CONFIRMED', confirmedAt: new Date() }, 'confirmar');
        await reserveStock(tx, order.warehouseId, order.items);
      });
      await audit(req, { action: 'CONFIRM', entity: 'SalesOrder', entityId: params.id });
      await statusEvent(params.id, 'CONFIRMED');
      return findOrder(params.id);
    },
  )
  .post(
    '/:id/fulfill',
    { summary: 'Despachar orden', description: 'Consume la reserva y descuenta el stock (movimientos SALE). CONFIRMED → FULFILLED', role: 'OPERATOR', params: IdParams, response: SalesOrderOut },
    async ({ req, params }) => {
      const order = await findOrder(params.id);
      await inTransaction(async (tx) => {
        await transition((a) => tx.salesOrder.updateMany(a), params.id, ['CONFIRMED'], { status: 'FULFILLED', fulfilledAt: new Date() }, 'despachar');
        for (const item of order.items) {
          await applyStockChange(tx, {
            type: 'SALE',
            productId: item.productId,
            warehouseId: order.warehouseId,
            delta: -item.quantity,
            consumeReserved: true,
            reference: order.number,
            userId: req.auth?.userId,
            salesOrderId: order.id,
          });
        }
      });
      await audit(req, { action: 'FULFILL', entity: 'SalesOrder', entityId: params.id });
      await statusEvent(params.id, 'FULFILLED');
      await notifyLowStock(order.items.map((i) => i.productId));
      return findOrder(params.id);
    },
  )
  .post('/:id/cancel', { summary: 'Cancelar orden', description: 'Solo DRAFT o CONFIRMED. Si estaba confirmada, libera la reserva.', role: 'OPERATOR', params: IdParams, response: SalesOrderOut }, async ({ req, params }) => {
    const order = await findOrder(params.id);
    await inTransaction(async (tx) => {
      // Bloquea la orden para conocer su estado real antes de cancelar
      const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM sales_orders WHERE id = ${params.id}::uuid FOR UPDATE`;
      await transition((a) => tx.salesOrder.updateMany(a), params.id, ['DRAFT', 'CONFIRMED'], { status: 'CANCELLED', cancelledAt: new Date() }, 'cancelar');
      if (locked?.status === 'CONFIRMED') await releaseReservation(tx, order.warehouseId, order.items);
    });
    await audit(req, { action: 'CANCEL', entity: 'SalesOrder', entityId: params.id });
    await statusEvent(params.id, 'CANCELLED');
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
