import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createCompany, createUser, login, prisma, resetDb, setupUsers, type TestCompany } from './helpers.js';

/**
 * Aislamiento multiempresa y restricción por sucursal.
 * Empresa A (2 sucursales) y empresa B: ningún dato de una debe ser visible ni modificable desde la otra.
 */
describe('Multiempresa y multisucursal', () => {
  let a: Awaited<ReturnType<typeof setupUsers>>;
  let b: Awaited<ReturnType<typeof setupUsers>>;
  let companyA: TestCompany;
  let branchNorte: string;
  let whCentral: string;
  let whNorte: string;
  let whB: string;
  let productA: string;
  let productB: string;
  let norteToken: string;

  beforeAll(async () => {
    await resetDb();
    companyA = await createCompany('Empresa A');
    a = await setupUsers(companyA, '-a');
    b = await setupUsers(await createCompany('Empresa B'), '-b');

    branchNorte = (await api().post('/api/v1/branches').set(auth(a.ADMIN)).send({ code: 'NORTE', name: 'Sucursal Norte' })).body.id;
    whCentral = (await api().post('/api/v1/warehouses').set(auth(a.MANAGER)).send({ code: 'CEN', name: 'Central', branchId: companyA.branchId })).body.id;
    whNorte = (await api().post('/api/v1/warehouses').set(auth(a.MANAGER)).send({ code: 'NOR', name: 'Norte', branchId: branchNorte })).body.id;
    whB = (await api().post('/api/v1/warehouses').set(auth(b.MANAGER)).send({ code: 'CEN', name: 'Central B', branchId: b.company.branchId })).body.id;

    productA = (
      await api()
        .post('/api/v1/products')
        .set(auth(a.MANAGER))
        .send({ sku: 'SKU-1', name: 'Producto A', salePrice: 1000, initialStock: { warehouseId: whCentral, quantity: 10 } })
    ).body.id;
    await api().post('/api/v1/inventory/entries').set(auth(a.OPERATOR)).send({ warehouseId: whNorte, items: [{ productId: productA, quantity: 5 }] });
    productB = (
      await api()
        .post('/api/v1/products')
        .set(auth(b.MANAGER))
        .send({ sku: 'SKU-1', name: 'Producto B', salePrice: 2000, initialStock: { warehouseId: whB, quantity: 3 } })
    ).body.id;

    // Operador de A restringido a la sucursal Norte
    const user = await createUser('OPERATOR', 'norte@test.local', companyA, [branchNorte]);
    norteToken = await login(user.email);
  });
  afterAll(() => prisma.$disconnect());

  it('el mismo SKU y código de almacén pueden repetirse en empresas distintas', () => {
    expect(productA).toBeDefined();
    expect(productB).toBeDefined();
    expect(whB).toBeDefined();
  });

  it('cada empresa solo ve sus propios datos', async () => {
    const listA = await api().get('/api/v1/products').set(auth(a.VIEWER));
    expect(listA.body.data.map((p: { name: string }) => p.name)).toEqual(['Producto A']);
    const listB = await api().get('/api/v1/products').set(auth(b.VIEWER));
    expect(listB.body.data.map((p: { name: string }) => p.name)).toEqual(['Producto B']);

    const whs = await api().get('/api/v1/warehouses').set(auth(b.VIEWER));
    expect(whs.body.meta.total).toBe(1);
    const users = await api().get('/api/v1/users').set(auth(b.ADMIN));
    expect(users.body.meta.total).toBe(4);
  });

  it('no permite leer ni modificar recursos de otra empresa por ID', async () => {
    expect((await api().get(`/api/v1/products/${productA}`).set(auth(b.ADMIN))).status).toBe(404);
    expect((await api().patch(`/api/v1/products/${productA}`).set(auth(b.ADMIN)).send({ name: 'hack' })).status).toBe(404);
    expect((await api().delete(`/api/v1/warehouses/${whCentral}`).set(auth(b.ADMIN))).status).toBe(404);
    expect((await api().get(`/api/v1/products/${productA}/movements`).set(auth(b.ADMIN))).body.meta.total).toBe(0);
  });

  it('no permite operar stock con productos o almacenes de otra empresa', async () => {
    const foreignWarehouse = await api().post('/api/v1/inventory/entries').set(auth(b.OPERATOR)).send({ warehouseId: whCentral, items: [{ productId: productB, quantity: 1 }] });
    expect(foreignWarehouse.status).toBe(404);
    const foreignProduct = await api().post('/api/v1/inventory/exits').set(auth(b.OPERATOR)).send({ warehouseId: whB, items: [{ productId: productA, quantity: 1 }] });
    expect(foreignProduct.status).toBe(404);
    const foreignOrder = await api().post('/api/v1/sales-orders').set(auth(b.OPERATOR)).send({ warehouseId: whB, items: [{ productId: productA, quantity: 1 }] });
    expect(foreignOrder.status).toBe(404);
  });

  it('los correlativos de órdenes son independientes por empresa', async () => {
    const soA = await api().post('/api/v1/sales-orders').set(auth(a.OPERATOR)).send({ warehouseId: whCentral, items: [{ productId: productA, quantity: 1 }] });
    const soB = await api().post('/api/v1/sales-orders').set(auth(b.OPERATOR)).send({ warehouseId: whB, items: [{ productId: productB, quantity: 1 }] });
    expect(soA.body.number).toBe('OV-000001');
    expect(soB.body.number).toBe('OV-000001');
  });

  it('los reportes solo agregan datos de la empresa', async () => {
    const dashA = await api().get('/api/v1/reports/dashboard').set(auth(a.VIEWER));
    const dashB = await api().get('/api/v1/reports/dashboard').set(auth(b.VIEWER));
    expect(dashA.body.totals).toMatchObject({ products: 1, units: 15, branches: 2, warehouses: 2 });
    expect(dashB.body.totals).toMatchObject({ products: 1, units: 3, branches: 1, warehouses: 1 });
    const byBranch = await api().get('/api/v1/reports/valuation?groupBy=branch').set(auth(a.VIEWER));
    expect(byBranch.body.map((r: { name: string; units: number }) => [r.name, r.units]).sort()).toEqual([
      ['Casa Matriz', 10],
      ['Sucursal Norte', 5],
    ]);
  });

  it('un usuario restringido a una sucursal solo ve y opera esa sucursal', async () => {
    const whs = await api().get('/api/v1/warehouses').set(auth(norteToken));
    expect(whs.body.data.map((w: { code: string }) => w.code)).toEqual(['NOR']);

    const product = await api().get(`/api/v1/products/${productA}`).set(auth(norteToken));
    expect(product.body.totalStock).toBe(5); // solo cuenta su sucursal
    expect(product.body.stocks).toHaveLength(1);

    const stock = await api().get('/api/v1/inventory/stock').set(auth(norteToken));
    expect(stock.body.data.every((s: { warehouseId: string }) => s.warehouseId === whNorte)).toBe(true);

    const other = await api().post('/api/v1/inventory/exits').set(auth(norteToken)).send({ warehouseId: whCentral, items: [{ productId: productA, quantity: 1 }] });
    expect(other.status).toBe(403);
    expect((await api().get(`/api/v1/inventory/stock?warehouseId=${whCentral}`).set(auth(norteToken))).status).toBe(403);

    const own = await api().post('/api/v1/inventory/exits').set(auth(norteToken)).send({ warehouseId: whNorte, items: [{ productId: productA, quantity: 1 }] });
    expect(own.status).toBe(201);

    const orders = await api().get('/api/v1/sales-orders').set(auth(norteToken));
    expect(orders.body.meta.total).toBe(0); // la orden de Casa Matriz no es visible
  });

  it('un usuario puede pertenecer a varias empresas y cambiar entre ellas', async () => {
    // El VIEWER de B también accede a A como MANAGER
    const shared = await prisma.user.findUniqueOrThrow({ where: { email: 'viewer-b@test.local' } });
    await prisma.membership.create({ data: { userId: shared.id, companyId: companyA.companyId, role: 'MANAGER' } });

    const loginRes = await api().post('/api/v1/auth/login').send({ email: 'viewer-b@test.local', password: 'Secret123!', companyId: b.company.companyId });
    expect(loginRes.body.role).toBe('VIEWER');
    expect(loginRes.body.companies).toHaveLength(2);

    const switched = await api()
      .post('/api/v1/auth/switch-company')
      .set(auth(loginRes.body.accessToken))
      .send({ companyId: companyA.companyId, refreshToken: loginRes.body.refreshToken });
    expect(switched.status).toBe(200);
    expect(switched.body.company.id).toBe(companyA.companyId);
    expect(switched.body.role).toBe('MANAGER');
    const list = await api().get('/api/v1/products').set(auth(switched.body.accessToken));
    expect(list.body.data[0].name).toBe('Producto A');

    // No puede cambiar a una empresa ajena
    const other = await createCompany('Empresa C');
    const denied = await api().post('/api/v1/auth/switch-company').set(auth(switched.body.accessToken)).send({ companyId: other.companyId });
    expect(denied.status).toBe(403);
  });

  it('agregar a un usuario existente no cambia su contraseña y quitarlo revoca su acceso', async () => {
    const res = await api().post('/api/v1/users').set(auth(b.ADMIN)).send({ email: 'norte@test.local', name: 'Otro nombre', role: 'VIEWER', password: 'Nueva12345' });
    expect(res.status).toBe(201);
    expect(await login('norte@test.local', b.company.companyId)).toBeTruthy(); // sigue con su contraseña original

    // El admin de B no puede cambiar datos personales de un usuario compartido con A
    const rename = await api().patch(`/api/v1/users/${res.body.id}`).set(auth(b.ADMIN)).send({ name: 'Cambiado' });
    expect(rename.status).toBe(403);

    expect((await api().delete(`/api/v1/users/${res.body.id}`).set(auth(b.ADMIN))).status).toBe(204);
    const again = await api().post('/api/v1/auth/login').send({ email: 'norte@test.local', password: 'Secret123!', companyId: b.company.companyId });
    expect(again.status).toBe(403);
  });

  it('las API keys quedan ligadas a su empresa y sucursales', async () => {
    const key = await api().post('/api/v1/api-keys').set(auth(a.ADMIN)).send({ name: 'POS Norte', role: 'OPERATOR', branchIds: [branchNorte] });
    expect(key.status).toBe(201);
    const products = await api().get('/api/v1/products').set('X-API-Key', key.body.key);
    expect(products.body.data.map((p: { name: string }) => p.name)).toEqual(['Producto A']);
    const denied = await api().post('/api/v1/inventory/exits').set('X-API-Key', key.body.key).send({ warehouseId: whCentral, items: [{ productId: productA, quantity: 1 }] });
    expect(denied.status).toBe(403);

    const foreignBranch = await api().post('/api/v1/api-keys').set(auth(b.ADMIN)).send({ name: 'X', branchIds: [branchNorte] });
    expect(foreignBranch.status).toBe(400);
  });

  it('solo el administrador de plataforma gestiona empresas', async () => {
    expect((await api().get('/api/v1/companies').set(auth(a.ADMIN))).status).toBe(403);

    const root = await createUser('ADMIN', 'root@test.local');
    await prisma.user.update({ where: { id: root.id }, data: { isSuperAdmin: true } });
    const token = await login('root@test.local');

    const created = await api()
      .post('/api/v1/companies')
      .set(auth(token))
      .send({ rut: '77.888.999-4', name: 'Nueva Empresa SpA', admin: { email: 'admin@nueva.cl', name: 'Admin Nueva', password: 'Nueva12345' } });
    expect(created.status).toBe(201);
    expect(created.body.rut).toBe('77888999-4');
    expect(created.body._count).toMatchObject({ branches: 1, memberships: 1 });

    const bad = await api().post('/api/v1/companies').set(auth(token)).send({ rut: '77.888.999-0', name: 'RUT malo' });
    expect(bad.status).toBe(400);

    // El nuevo administrador entra directo a su empresa
    const newAdmin = await api().post('/api/v1/auth/login').send({ email: 'admin@nueva.cl', password: 'Nueva12345' });
    expect(newAdmin.body.company.name).toBe('Nueva Empresa SpA');
    expect(newAdmin.body.role).toBe('ADMIN');
    expect(newAdmin.body.branches).toHaveLength(1);
  });

  it('webhooks y auditoría no se mezclan entre empresas', async () => {
    await api().post('/api/v1/webhooks').set(auth(a.ADMIN)).send({ name: 'ERP A', url: 'http://127.0.0.1:9/a', events: ['*'] });
    expect((await api().get('/api/v1/webhooks').set(auth(b.ADMIN))).body).toHaveLength(0);
    const auditB = await api().get('/api/v1/audit-logs?entity=Webhook').set(auth(b.ADMIN));
    expect(auditB.body.meta.total).toBe(0);
  });
});
