import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@prisma/client';
import { api, auth, prisma, resetDb, setupUsers } from './helpers.js';
import { formatRut, isValidRut, normalizeRut } from '../src/lib/rut.js';
import { orderTotals } from '../src/modules/_shared/orders.js';
import { processDueDeliveries, sign } from '../src/lib/webhooks.js';

describe('RUT chileno', () => {
  it('valida el dígito verificador', () => {
    expect(isValidRut('76.123.456-0')).toBe(true);
    expect(isValidRut('761234560')).toBe(true);
    expect(isValidRut('76.123.456-1')).toBe(false);
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('11.111.111-1')).toBe(true);
    expect(isValidRut('abc')).toBe(false);
  });
  it('normaliza y formatea', () => {
    expect(normalizeRut('76.123.456-0')).toBe('76123456-0');
    expect(formatRut('761234560')).toBe('76.123.456-0');
  });
});

describe('IVA', () => {
  it('calcula neto, IVA y total redondeando a pesos', () => {
    const t = orderTotals([
      { quantity: 3, price: 9990, taxRate: 19 },
      { quantity: 1, price: 45000, taxRate: 0 }, // exento
    ]);
    expect(t.subtotal.toString()).toBe('74970'); // 29970 + 45000
    expect(t.tax.toString()).toBe('5694'); // 29970 × 19 % = 5694,3
    expect(t.total.toString()).toBe('80664');
  });
});

describe('Reservas de stock, IVA en órdenes y webhooks', () => {
  let t: Record<Role, string>;
  let warehouseId: string;
  let productId: string;
  let exemptId: string;

  beforeAll(async () => {
    await resetDb();
    t = await setupUsers();
    warehouseId = (await api().post('/api/v1/warehouses').set(auth(t.MANAGER)).send({ code: 'STGO', name: 'Santiago' })).body.id;
    productId = (
      await api()
        .post('/api/v1/products')
        .set(auth(t.MANAGER))
        .send({ sku: 'P1', name: 'Producto afecto', salePrice: 10000, initialStock: { warehouseId, quantity: 10 } })
    ).body.id;
    exemptId = (
      await api()
        .post('/api/v1/products')
        .set(auth(t.MANAGER))
        .send({ sku: 'P2', name: 'Servicio exento', salePrice: 5000, taxExempt: true, initialStock: { warehouseId, quantity: 5 } })
    ).body.id;
  });
  afterAll(() => prisma.$disconnect());

  it('rechaza RUT inválido y normaliza el válido', async () => {
    const bad = await api().post('/api/v1/customers').set(auth(t.MANAGER)).send({ name: 'X', taxId: '76.123.456-1' });
    expect(bad.status).toBe(400);
    const ok = await api().post('/api/v1/customers').set(auth(t.MANAGER)).send({ name: 'Cliente SpA', taxId: '76.987.654-5' });
    expect(ok.status).toBe(201);
    expect(ok.body.taxId).toBe('76987654-5');
    const found = await api().get('/api/v1/customers?search=76.987.654').set(auth(t.VIEWER));
    expect(found.body.meta.total).toBe(1);
  });

  let orderId: string;
  it('aplica IVA solo a productos afectos', async () => {
    const res = await api()
      .post('/api/v1/sales-orders')
      .set(auth(t.OPERATOR))
      .send({ warehouseId, items: [{ productId, quantity: 6 }, { productId: exemptId, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBe('65000');
    expect(res.body.tax).toBe('11400'); // 60000 × 19 %
    expect(res.body.total).toBe('76400');
    orderId = res.body.id;
  });

  it('confirmar reserva stock y bloquea salidas sobre lo reservado', async () => {
    const confirmed = await api().post(`/api/v1/sales-orders/${orderId}/confirm`).set(auth(t.OPERATOR));
    expect(confirmed.status).toBe(200);

    const stock = await api().get(`/api/v1/inventory/stock?productId=${productId}`).set(auth(t.VIEWER));
    expect(stock.body.data[0]).toMatchObject({ quantity: 10, reserved: 6, available: 4 });

    const product = await api().get(`/api/v1/products/${productId}`).set(auth(t.VIEWER));
    expect(product.body).toMatchObject({ totalStock: 10, reservedStock: 6, availableStock: 4 });

    // Solo hay 4 disponibles: una salida de 5 debe fallar aunque haya 10 físicas
    const exit = await api().post('/api/v1/inventory/exits').set(auth(t.OPERATOR)).send({ warehouseId, items: [{ productId, quantity: 5 }] });
    expect(exit.status).toBe(422);
    expect(exit.body.error.details).toMatchObject({ available: 4, reserved: 6 });

    // Otra venta por 5 no se puede confirmar
    const other = await api().post('/api/v1/sales-orders').set(auth(t.OPERATOR)).send({ warehouseId, items: [{ productId, quantity: 5 }] });
    const otherConfirm = await api().post(`/api/v1/sales-orders/${other.body.id}/confirm`).set(auth(t.OPERATOR));
    expect(otherConfirm.status).toBe(422);
    expect(otherConfirm.body.error.details.shortages[0].available).toBe(4);
    // ... y el intento fallido no dejó la orden confirmada
    expect((await api().get(`/api/v1/sales-orders/${other.body.id}`).set(auth(t.VIEWER))).body.status).toBe('DRAFT');
  });

  it('despachar consume la reserva', async () => {
    const res = await api().post(`/api/v1/sales-orders/${orderId}/fulfill`).set(auth(t.OPERATOR));
    expect(res.status).toBe(200);
    const stock = await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } });
    expect(stock).toMatchObject({ quantity: 4, reserved: 0 });
  });

  it('cancelar una orden confirmada libera la reserva', async () => {
    const order = await api().post('/api/v1/sales-orders').set(auth(t.OPERATOR)).send({ warehouseId, items: [{ productId, quantity: 3 }] });
    await api().post(`/api/v1/sales-orders/${order.body.id}/confirm`).set(auth(t.OPERATOR));
    expect((await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } })).reserved).toBe(3);
    await api().post(`/api/v1/sales-orders/${order.body.id}/cancel`).set(auth(t.OPERATOR));
    expect((await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } })).reserved).toBe(0);
  });

  it('envía webhooks firmados y reintenta ante errores', async () => {
    const received: { headers: IncomingMessage['headers']; body: string }[] = [];
    let failNext = true;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = failNext ? 500 : 200;
        failNext = false;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

    try {
      const created = await api().post('/api/v1/webhooks').set(auth(t.ADMIN)).send({ name: 'ERP', url, events: ['inventory.movements.created'] });
      expect(created.status).toBe(201);
      expect(created.body.secret).toMatch(/^whsec_/);
      expect((await api().post('/api/v1/webhooks').set(auth(t.MANAGER)).send({ name: 'X', url, events: ['*'] })).status).toBe(403);

      await api().post('/api/v1/inventory/entries').set(auth(t.OPERATOR)).send({ warehouseId, items: [{ productId, quantity: 1 }] });
      // Otro evento no suscrito no genera envíos
      await api().post('/api/v1/products').set(auth(t.MANAGER)).send({ sku: 'P3', name: 'Otro' });

      // 1er intento: el receptor responde 500 → queda pendiente con reintento programado
      expect(await processDueDeliveries()).toBe(1);
      let deliveries = await api().get(`/api/v1/webhooks/${created.body.id}/deliveries`).set(auth(t.ADMIN));
      expect(deliveries.body.data[0]).toMatchObject({ status: 'PENDING', attempts: 1, responseStatus: 500 });

      // Reintento manual → éxito
      await api().post(`/api/v1/webhooks/deliveries/${deliveries.body.data[0].id}/retry`).set(auth(t.ADMIN));
      expect(await processDueDeliveries()).toBe(1);
      deliveries = await api().get(`/api/v1/webhooks/${created.body.id}/deliveries`).set(auth(t.ADMIN));
      expect(deliveries.body.data[0].status).toBe('SUCCESS');

      // Firma verificable con el secreto
      const last = received.at(-1)!;
      const ts = Number(last.headers['x-webhook-timestamp']);
      expect(last.headers['x-webhook-event']).toBe('inventory.movements.created');
      expect(last.headers['x-webhook-signature']).toBe(sign(created.body.secret, ts, last.body));
      expect(JSON.parse(last.body).data.movements[0].quantity).toBe(1);
      expect(received).toHaveLength(2);
    } finally {
      server.close();
    }
  });
});
