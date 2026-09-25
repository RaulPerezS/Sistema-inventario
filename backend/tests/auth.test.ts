import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createCompany, createUser, PASSWORD, prisma, resetDb } from './helpers.js';

describe('Autenticación', () => {
  beforeAll(async () => {
    await resetDb();
    await createUser('ADMIN', 'admin@test.local', await createCompany());
  });
  afterAll(() => prisma.$disconnect());

  it('rechaza credenciales inválidas', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'admin@test.local', password: 'incorrecta' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('valida el cuerpo de la petición', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'no-es-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('inicia sesión, consulta perfil y rota el refresh token', async () => {
    const login = await api().post('/api/v1/auth/login').send({ email: 'ADMIN@test.local', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user).not.toHaveProperty('passwordHash');
    expect(login.headers['set-cookie']?.[0]).toMatch(/refresh_token=.*HttpOnly/);

    const me = await api().get('/api/v1/auth/me').set(auth(login.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('admin@test.local');
    expect(me.body.role).toBe('ADMIN');
    expect(me.body.company).not.toBeNull();

    const refreshed = await api().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);

    // Reutilizar el token anterior se detecta y revoca todas las sesiones
    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(reuse.status).toBe(401);
    const afterReuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: refreshed.body.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('exige token en rutas protegidas', async () => {
    const res = await api().get('/api/v1/products');
    expect(res.status).toBe(401);
    const bad = await api().get('/api/v1/products').set(auth('token-falso'));
    expect(bad.status).toBe(401);
  });

  it('permite cambiar la contraseña', async () => {
    const { body } = await api().post('/api/v1/auth/login').send({ email: 'admin@test.local', password: PASSWORD });
    const res = await api()
      .patch('/api/v1/auth/me/password')
      .set(auth(body.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'NuevaClave123' });
    expect(res.status).toBe(204);
    const relogin = await api().post('/api/v1/auth/login').send({ email: 'admin@test.local', password: 'NuevaClave123' });
    expect(relogin.status).toBe(200);
  });
});
