import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/crypto.js';

export const app = createApp();
export const api = () => request(app);
export { prisma };

const TABLES = [
  'webhook_deliveries', 'webhooks', 'memberships', 'branches', 'companies',
  'audit_logs', 'stock_movements', 'sales_order_items', 'sales_orders', 'purchase_order_items', 'purchase_orders',
  'stocks', 'products', 'categories', 'suppliers', 'customers', 'warehouses', 'api_keys', 'refresh_tokens', 'users', 'sequences',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}

export const PASSWORD = 'Secret123!';

export interface TestCompany {
  companyId: string;
  branchId: string;
}

let seq = 0;
/** Crea una empresa con su sucursal principal. */
export async function createCompany(name = 'Empresa Test'): Promise<TestCompany> {
  seq++;
  const company = await prisma.company.create({ data: { name, rut: `${1000000 + seq}-${seq % 10}` } });
  const branch = await prisma.branch.create({ data: { companyId: company.id, code: 'MATRIZ', name: 'Casa Matriz' } });
  return { companyId: company.id, branchId: branch.id };
}

export async function createUser(role: Role, email = `${role.toLowerCase()}@test.local`, company?: TestCompany, branchIds: string[] = []) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: `Usuario ${role}`, passwordHash: await hashPassword(PASSWORD) },
  });
  if (company) await prisma.membership.create({ data: { userId: user.id, companyId: company.companyId, role, branchIds } });
  return user;
}

export async function login(email: string, companyId?: string) {
  const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD, companyId });
  if (res.status !== 200) throw new Error(`Login falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

/** Crea una empresa y usuarios de todos los roles en ella; devuelve sus tokens. */
export async function setupUsers(company?: TestCompany, suffix = '') {
  const c = company ?? (await createCompany());
  const roles: Role[] = ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'];
  const tokens = {} as Record<Role, string>;
  for (const role of roles) {
    const user = await createUser(role, `${role.toLowerCase()}${suffix}@test.local`, c);
    tokens[role] = await login(user.email, c.companyId);
  }
  return Object.assign(tokens, { company: c });
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
