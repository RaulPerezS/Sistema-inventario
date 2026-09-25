import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, prisma, resetDb, setupUsers } from './helpers.js';

describe('Roles, permisos y API keys', () => {
  let tokens: Awaited<ReturnType<typeof setupUsers>>;
  beforeAll(async () => {
    await resetDb();
    tokens = await setupUsers();
  });
  afterAll(() => prisma.$disconnect());

  it('VIEWER puede leer pero no crear', async () => {
    expect((await api().get('/api/v1/warehouses').set(auth(tokens.VIEWER))).status).toBe(200);
    const res = await api().post('/api/v1/warehouses').set(auth(tokens.VIEWER)).send({ code: 'X1', name: 'X', branchId: tokens.company.branchId });
    expect(res.status).toBe(403);
  });

  it('solo ADMIN gestiona usuarios', async () => {
    expect((await api().get('/api/v1/users').set(auth(tokens.MANAGER))).status).toBe(403);
    const res = await api().get('/api/v1/users').set(auth(tokens.ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(4);
  });

  it('ADMIN no puede quitarse su propio rol', async () => {
    const me = await api().get('/api/v1/auth/me').set(auth(tokens.ADMIN));
    const res = await api().patch(`/api/v1/users/${me.body.user.id}`).set(auth(tokens.ADMIN)).send({ role: 'VIEWER' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/a sí mismo/);
  });

  it('crea una API key, la usa y la revoca', async () => {
    const created = await api().post('/api/v1/api-keys').set(auth(tokens.ADMIN)).send({ name: 'ERP', role: 'OPERATOR' });
    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^inv_/);

    const key = created.body.key as string;
    expect((await api().get('/api/v1/products').set('X-API-Key', key)).status).toBe(200);
    // OPERATOR no puede crear catálogo
    expect((await api().post('/api/v1/categories').set('X-API-Key', key).send({ name: 'Nueva' })).status).toBe(403);
    // Endpoints de usuario no aceptan API keys
    expect((await api().get('/api/v1/auth/me').set('X-API-Key', key)).status).toBe(403);

    expect((await api().delete(`/api/v1/api-keys/${created.body.id}`).set(auth(tokens.ADMIN))).status).toBe(204);
    expect((await api().get('/api/v1/products').set('X-API-Key', key)).status).toBe(401);
  });

  it('no permite API keys con rol ADMIN', async () => {
    const res = await api().post('/api/v1/api-keys').set(auth(tokens.ADMIN)).send({ name: 'X', role: 'ADMIN' });
    expect(res.status).toBe(400);
  });

  it('registra auditoría', async () => {
    const res = await api().get('/api/v1/audit-logs?entity=ApiKey').set(auth(tokens.ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.data.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['CREATE', 'REVOKE']));
  });
});
