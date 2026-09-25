import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/crypto.js';

export const app = createApp();
export const api = () => request(app);
export { prisma };

const TABLES = [
  'audit_logs', 'stock_movements', 'sales_order_items', 'sales_orders', 'purchase_order_items', 'purchase_orders',
  'stocks', 'products', 'categories', 'suppliers', 'customers', 'warehouses', 'api_keys', 'refresh_tokens', 'users', 'sequences',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}

export const PASSWORD = 'Secret123!';

export async function createUser(role: Role, email = `${role.toLowerCase()}@test.local`) {
  return prisma.user.create({ data: { email, name: `Usuario ${role}`, role, passwordHash: await hashPassword(PASSWORD) } });
}

export async function login(email: string) {
  const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

/** Crea usuarios de todos los roles y devuelve sus tokens. */
export async function setupUsers() {
  const roles: Role[] = ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'];
  const tokens = {} as Record<Role, string>;
  for (const role of roles) {
    const user = await createUser(role);
    tokens[role] = await login(user.email);
  }
  return tokens;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
