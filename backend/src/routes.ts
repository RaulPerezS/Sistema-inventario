import { Router } from 'express';
import { z } from './docs/zod.js';
import { ApiRouter } from './lib/router.js';
import { prisma } from './lib/prisma.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { apiKeysRouter } from './modules/api-keys/api-keys.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { suppliersRouter } from './modules/suppliers/suppliers.routes.js';
import { customersRouter } from './modules/customers/customers.routes.js';
import { warehousesRouter } from './modules/warehouses/warehouses.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { purchaseOrdersRouter } from './modules/purchase-orders/purchase-orders.routes.js';
import { salesOrdersRouter } from './modules/sales-orders/sales-orders.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { webhooksRouter } from './modules/webhooks/webhooks.routes.js';
import { companiesRouter, currentCompanyRouter } from './modules/companies/companies.routes.js';
import { branchesRouter } from './modules/branches/branches.routes.js';

const healthRouter = new ApiRouter('/health', 'Sistema').get(
  '/',
  {
    summary: 'Estado del servicio y la base de datos',
    role: 'public',
    response: z.object({ status: z.enum(['ok', 'degraded']), uptime: z.number(), database: z.enum(['up', 'down']), timestamp: z.string() }),
  },
  async ({ res }) => {
    let database: 'up' | 'down' = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const status = database === 'up' ? 'ok' : 'degraded';
    res.status(status === 'ok' ? 200 : 503);
    return { status, uptime: Math.round(process.uptime()), database, timestamp: new Date().toISOString() };
  },
);

const modules: [string, ApiRouter][] = [
  ['/health', healthRouter],
  ['/auth', authRouter],
  ['/companies', companiesRouter],
  ['/company', currentCompanyRouter],
  ['/branches', branchesRouter],
  ['/users', usersRouter],
  ['/api-keys', apiKeysRouter],
  ['/categories', categoriesRouter],
  ['/suppliers', suppliersRouter],
  ['/customers', customersRouter],
  ['/warehouses', warehousesRouter],
  ['/products', productsRouter],
  ['/inventory', inventoryRouter],
  ['/purchase-orders', purchaseOrdersRouter],
  ['/sales-orders', salesOrdersRouter],
  ['/reports', reportsRouter],
  ['/audit-logs', auditRouter],
  ['/webhooks', webhooksRouter],
];

export const apiRouter = Router();
for (const [path, module] of modules) apiRouter.use(path, module.router);
