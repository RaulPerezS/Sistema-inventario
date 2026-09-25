import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, prisma, resetDb, setupUsers } from './helpers.js';

describe('Catálogo, stock y órdenes', () => {
  let t: Awaited<ReturnType<typeof setupUsers>>;
  let central: string;
  let norte: string;
  let productId: string;
  let supplierId: string;

  beforeAll(async () => {
    await resetDb();
    t = await setupUsers();
    central = (await api().post('/api/v1/warehouses').set(auth(t.MANAGER)).send({ code: 'central', name: 'Central', branchId: t.company.branchId })).body.id;
    norte = (await api().post('/api/v1/warehouses').set(auth(t.MANAGER)).send({ code: 'NORTE', name: 'Norte', branchId: t.company.branchId })).body.id;
    supplierId = (await api().post('/api/v1/suppliers').set(auth(t.MANAGER)).send({ name: 'Proveedor Uno', taxId: '76.123.456-0' })).body.id;
  });
  afterAll(() => prisma.$disconnect());

  it('normaliza el código de almacén y evita duplicados', async () => {
    const list = await api().get('/api/v1/warehouses').set(auth(t.VIEWER));
    expect(list.body.data.map((w: { code: string }) => w.code)).toEqual(['CENTRAL', 'NORTE']);
    const dup = await api().post('/api/v1/warehouses').set(auth(t.MANAGER)).send({ code: 'CENTRAL', name: 'Otro', branchId: t.company.branchId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
  });

  it('crea producto con stock inicial', async () => {
    const res = await api()
      .post('/api/v1/products')
      .set(auth(t.MANAGER))
      .send({ sku: 'prd-1', name: 'Producto 1', costPrice: 10, salePrice: 15, minStock: 5, supplierId, initialStock: { warehouseId: central, quantity: 20 } });
    expect(res.status).toBe(201);
    expect(res.body.sku).toBe('PRD-1');
    expect(res.body.totalStock).toBe(20);
    expect(res.body.stocks).toHaveLength(1);
    productId = res.body.id;
  });

  it('valida que el stock máximo sea mayor al mínimo', async () => {
    const res = await api().post('/api/v1/products').set(auth(t.MANAGER)).send({ sku: 'X', name: 'Mal', minStock: 10, maxStock: 5 });
    expect(res.status).toBe(400);
  });

  it('registra entradas con costo promedio ponderado', async () => {
    const res = await api()
      .post('/api/v1/inventory/entries')
      .set(auth(t.OPERATOR))
      .send({ warehouseId: central, reference: 'FAC-1', items: [{ productId, quantity: 20, unitCost: 20 }] });
    expect(res.status).toBe(201);
    expect(res.body.movements[0].balanceAfter).toBe(40);
    const product = await api().get(`/api/v1/products/${productId}`).set(auth(t.VIEWER));
    expect(product.body.costPrice).toBe('15'); // (20×10 + 20×20) / 40
  });

  it('impide salidas sin stock suficiente (422) y no deja cambios parciales', async () => {
    const res = await api()
      .post('/api/v1/inventory/exits')
      .set(auth(t.OPERATOR))
      .send({ warehouseId: central, items: [{ productId, quantity: 41 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.details.available).toBe(40);
  });

  it('transfiere entre almacenes', async () => {
    const res = await api()
      .post('/api/v1/inventory/transfers')
      .set(auth(t.OPERATOR))
      .send({ fromWarehouseId: central, toWarehouseId: norte, items: [{ productId, quantity: 10 }] });
    expect(res.status).toBe(201);
    expect(res.body.movements).toHaveLength(2);
    const product = await api().get(`/api/v1/products/${productId}`).set(auth(t.VIEWER));
    expect(product.body.totalStock).toBe(40);
    expect(product.body.stocks.map((s: { quantity: number }) => s.quantity).sort()).toEqual([10, 30]);
  });

  it('ajusta por conteo físico', async () => {
    const res = await api()
      .post('/api/v1/inventory/adjustments')
      .set(auth(t.MANAGER))
      .send({ warehouseId: norte, items: [{ productId, countedQuantity: 8 }] });
    expect(res.status).toBe(201);
    expect(res.body.movements[0].quantity).toBe(-2);
    expect(res.body.movements[0].balanceAfter).toBe(8);
  });

  it('maneja salidas concurrentes sin stock negativo', async () => {
    // 8 unidades en NORTE; 5 solicitudes concurrentes de 3 → solo 2 pueden completarse
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().post('/api/v1/inventory/exits').set(auth(t.OPERATOR)).send({ warehouseId: norte, items: [{ productId, quantity: 3 }] }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const stock = await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId: norte } } });
    expect(stock.quantity).toBe(2);
  });

  it('ciclo completo de orden de compra con recepción parcial', async () => {
    const created = await api()
      .post('/api/v1/purchase-orders')
      .set(auth(t.MANAGER))
      .send({ supplierId, warehouseId: central, items: [{ productId, quantity: 10, unitCost: 15 }] });
    expect(created.status).toBe(201);
    expect(created.body.number).toBe('OC-000001');
    // Neto 150 + IVA 19 % (28,5 → 29 en pesos) = 179
    expect(created.body.subtotal).toBe('150');
    expect(created.body.tax).toBe('29');
    expect(created.body.total).toBe('179');
    const id = created.body.id;

    expect((await api().post(`/api/v1/purchase-orders/${id}/receive`).set(auth(t.OPERATOR)).send({})).status).toBe(409);
    expect((await api().post(`/api/v1/purchase-orders/${id}/order`).set(auth(t.MANAGER))).body.status).toBe('ORDERED');

    const partial = await api().post(`/api/v1/purchase-orders/${id}/receive`).set(auth(t.OPERATOR)).send({ items: [{ productId, quantity: 4 }] });
    expect(partial.body.status).toBe('PARTIALLY_RECEIVED');
    const over = await api().post(`/api/v1/purchase-orders/${id}/receive`).set(auth(t.OPERATOR)).send({ items: [{ productId, quantity: 7 }] });
    expect(over.status).toBe(400);
    const rest = await api().post(`/api/v1/purchase-orders/${id}/receive`).set(auth(t.OPERATOR)).send({});
    expect(rest.body.status).toBe('RECEIVED');
    expect(rest.body.items[0].receivedQuantity).toBe(10);
    expect((await api().post(`/api/v1/purchase-orders/${id}/cancel`).set(auth(t.MANAGER))).status).toBe(409);
  });

  it('ciclo completo de orden de venta', async () => {
    const customer = await api().post('/api/v1/customers').set(auth(t.MANAGER)).send({ name: 'Cliente Uno' });
    const created = await api()
      .post('/api/v1/sales-orders')
      .set(auth(t.OPERATOR))
      .send({ customerId: customer.body.id, warehouseId: central, items: [{ productId, quantity: 5 }] });
    expect(created.status).toBe(201);
    expect(created.body.items[0].unitPrice).toBe('15');
    const id = created.body.id;

    expect((await api().post(`/api/v1/sales-orders/${id}/fulfill`).set(auth(t.OPERATOR))).status).toBe(409);
    expect((await api().post(`/api/v1/sales-orders/${id}/confirm`).set(auth(t.OPERATOR))).body.status).toBe('CONFIRMED');
    const fulfilled = await api().post(`/api/v1/sales-orders/${id}/fulfill`).set(auth(t.OPERATOR));
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.body.status).toBe('FULFILLED');

    const kardex = await api().get(`/api/v1/products/${productId}/movements?type=SALE`).set(auth(t.VIEWER));
    expect(kardex.body.data[0].quantity).toBe(-5);
    expect(kardex.body.data[0].reference).toBe('OV-000001');
  });

  it('rechaza la confirmación de ventas sin stock', async () => {
    const created = await api()
      .post('/api/v1/sales-orders')
      .set(auth(t.OPERATOR))
      .send({ warehouseId: norte, items: [{ productId, quantity: 999 }] });
    const res = await api().post(`/api/v1/sales-orders/${created.body.id}/confirm`).set(auth(t.OPERATOR));
    expect(res.status).toBe(422);
    expect(res.body.error.details.shortages[0].available).toBe(2);
  });

  it('no elimina productos con stock', async () => {
    const res = await api().delete(`/api/v1/products/${productId}`).set(auth(t.MANAGER));
    expect(res.status).toBe(409);
  });

  it('reportes y exportación CSV', async () => {
    const dash = await api().get('/api/v1/reports/dashboard').set(auth(t.VIEWER));
    expect(dash.status).toBe(200);
    expect(dash.body.totals.products).toBe(1);
    const top = await api().get('/api/v1/reports/top-products').set(auth(t.VIEWER));
    expect(top.body[0].units).toBeGreaterThan(0);
    const csv = await api().get('/api/v1/products/export').set(auth(t.VIEWER));
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('PRD-1');
    const lookup = await api().get('/api/v1/products/lookup?code=prd-1').set(auth(t.VIEWER));
    expect(lookup.body.id).toBe(productId);
  });

  it('expone la especificación OpenAPI', async () => {
    const res = await api().get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/products/{id}']).toBeDefined();
  });
});
