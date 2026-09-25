-- Multiempresa y multisucursal
-- Los datos existentes se asignan a una empresa y sucursal por defecto, sin pérdida de información.

-- DropIndex
DROP INDEX "audit_logs_createdAt_idx";

-- DropIndex
DROP INDEX "categories_name_key";

-- DropIndex
DROP INDEX "customers_taxId_key";

-- DropIndex
DROP INDEX "products_barcode_key";

-- DropIndex
DROP INDEX "products_name_idx";

-- DropIndex
DROP INDEX "products_sku_key";

-- DropIndex
DROP INDEX "purchase_orders_number_key";

-- DropIndex
DROP INDEX "purchase_orders_status_idx";

-- DropIndex
DROP INDEX "sales_orders_number_key";

-- DropIndex
DROP INDEX "sales_orders_status_idx";

-- DropIndex
DROP INDEX "suppliers_taxId_key";

-- DropIndex
DROP INDEX "warehouses_code_key";

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "rut" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "giro" TEXT,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "branchIds" UUID[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- Empresa y sucursal por defecto solo si ya existen datos
INSERT INTO "companies" ("id", "rut", "name", "tradeName", "updatedAt")
SELECT '00000000-0000-4000-8000-000000000001', '11111111-1', 'Empresa principal', 'Empresa principal', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "warehouses") OR EXISTS (SELECT 1 FROM "products");

INSERT INTO "branches" ("id", "companyId", "code", "name", "updatedAt")
SELECT '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'MATRIZ', 'Casa Matriz', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "companies" WHERE "id" = '00000000-0000-4000-8000-000000000001');

-- api_keys
ALTER TABLE "api_keys" ADD COLUMN "companyId" UUID;
UPDATE "api_keys" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "api_keys" ALTER COLUMN "companyId" SET NOT NULL;

-- categories
ALTER TABLE "categories" ADD COLUMN "companyId" UUID;
UPDATE "categories" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "categories" ALTER COLUMN "companyId" SET NOT NULL;

-- customers
ALTER TABLE "customers" ADD COLUMN "companyId" UUID;
UPDATE "customers" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "customers" ALTER COLUMN "companyId" SET NOT NULL;

-- products
ALTER TABLE "products" ADD COLUMN "companyId" UUID;
UPDATE "products" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "products" ALTER COLUMN "companyId" SET NOT NULL;

-- purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN "companyId" UUID;
UPDATE "purchase_orders" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "purchase_orders" ALTER COLUMN "companyId" SET NOT NULL;

-- sales_orders
ALTER TABLE "sales_orders" ADD COLUMN "companyId" UUID;
UPDATE "sales_orders" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "sales_orders" ALTER COLUMN "companyId" SET NOT NULL;

-- stock_movements
ALTER TABLE "stock_movements" ADD COLUMN "companyId" UUID;
UPDATE "stock_movements" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "stock_movements" ALTER COLUMN "companyId" SET NOT NULL;

-- suppliers
ALTER TABLE "suppliers" ADD COLUMN "companyId" UUID;
UPDATE "suppliers" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "suppliers" ALTER COLUMN "companyId" SET NOT NULL;

-- warehouses
ALTER TABLE "warehouses" ADD COLUMN "companyId" UUID;
UPDATE "warehouses" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "warehouses" ALTER COLUMN "companyId" SET NOT NULL;

-- webhooks
ALTER TABLE "webhooks" ADD COLUMN "companyId" UUID;
UPDATE "webhooks" SET "companyId" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "webhooks" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "warehouses" ADD COLUMN "branchId" UUID;
UPDATE "warehouses" SET "branchId" = '00000000-0000-4000-8000-000000000002';
ALTER TABLE "warehouses" ALTER COLUMN "branchId" SET NOT NULL;

ALTER TABLE "api_keys" ADD COLUMN "branchIds" UUID[];

ALTER TABLE "audit_logs" ADD COLUMN "companyId" UUID;
UPDATE "audit_logs" SET "companyId" = '00000000-0000-4000-8000-000000000001' WHERE EXISTS (SELECT 1 FROM "companies" WHERE "id" = '00000000-0000-4000-8000-000000000001');

-- Las sesiones anteriores no tienen empresa asociada: se invalidan
ALTER TABLE "refresh_tokens" ADD COLUMN "companyId" UUID;
UPDATE "refresh_tokens" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "revokedAt" IS NULL;

-- El rol de cada usuario pasa a su membresía en la empresa por defecto
INSERT INTO "memberships" ("id", "userId", "companyId", "role", "updatedAt")
SELECT gen_random_uuid(), u."id", '00000000-0000-4000-8000-000000000001', u."role", CURRENT_TIMESTAMP FROM "users" u
WHERE EXISTS (SELECT 1 FROM "companies" WHERE "id" = '00000000-0000-4000-8000-000000000001');

ALTER TABLE "users" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
-- Los administradores existentes pasan a ser administradores de plataforma
UPDATE "users" SET "isSuperAdmin" = true WHERE "role" = 'ADMIN';
ALTER TABLE "users" DROP COLUMN "role";

-- Correlativos por empresa
UPDATE "sequences" SET "key" = '00000000-0000-4000-8000-000000000001' || ':' || "key" WHERE "key" NOT LIKE '%:%';

-- CreateIndex
CREATE UNIQUE INDEX "companies_rut_key" ON "companies"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "branches_companyId_code_key" ON "branches"("companyId", "code");

-- CreateIndex
CREATE INDEX "memberships_companyId_idx" ON "memberships"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_companyId_key" ON "memberships"("userId", "companyId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "categories_companyId_name_key" ON "categories"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_taxId_key" ON "customers"("companyId", "taxId");

-- CreateIndex
CREATE INDEX "products_companyId_name_idx" ON "products"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_sku_key" ON "products"("companyId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_barcode_key" ON "products"("companyId", "barcode");

-- CreateIndex
CREATE INDEX "purchase_orders_companyId_status_idx" ON "purchase_orders"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_companyId_number_key" ON "purchase_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "sales_orders_companyId_status_idx" ON "sales_orders"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_companyId_number_key" ON "sales_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_createdAt_idx" ON "stock_movements"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_taxId_key" ON "suppliers"("companyId", "taxId");

-- CreateIndex
CREATE INDEX "warehouses_branchId_idx" ON "warehouses"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_companyId_code_key" ON "warehouses"("companyId", "code");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
