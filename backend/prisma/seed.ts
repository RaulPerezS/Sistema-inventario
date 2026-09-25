/* Datos de demostración multiempresa. Ejecutar con: npm run db:seed (idempotente) */
import { PrismaClient, Prisma, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const hash = (p: string) => bcrypt.hash(p, 10);
const DAY = 86_400_000;

async function upsertUser(email: string, name: string, password: string, isSuperAdmin = false) {
  return prisma.user.upsert({
    where: { email },
    update: { isSuperAdmin },
    create: { email, name, isSuperAdmin, passwordHash: await hash(password) },
  });
}

async function member(userId: string, companyId: string, role: Role, branchIds: string[] = []) {
  await prisma.membership.upsert({
    where: { userId_companyId: { userId, companyId } },
    update: {},
    create: { userId, companyId, role, branchIds },
  });
}

async function upsertCompany(data: { rut: string; name: string; tradeName: string; giro: string; address: string; city: string }) {
  return prisma.company.upsert({ where: { rut: data.rut }, update: {}, create: data });
}

async function branch(companyId: string, code: string, name: string, city: string) {
  return prisma.branch.upsert({
    where: { companyId_code: { companyId, code } },
    update: {},
    create: { companyId, code, name, city },
  });
}

interface ProductSeed {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  supplier: number;
  unit?: string;
  costPrice: number;
  salePrice: number;
  minStock: number;
  maxStock: number;
  taxExempt?: boolean;
  /** Stock inicial por almacén, en el mismo orden que `warehouses`. */
  stock: number[];
}

async function seedCatalog(opts: {
  companyId: string;
  userId: string;
  warehouses: { id: string }[];
  categories: { name: string; parent?: string }[];
  suppliers: Omit<Prisma.SupplierCreateManyInput, 'companyId'>[];
  customers: Omit<Prisma.CustomerCreateManyInput, 'companyId'>[];
  products: ProductSeed[];
}) {
  const { companyId } = opts;
  if ((await prisma.product.count({ where: { companyId } })) > 0) return false;

  const categories = new Map<string, string>();
  for (const c of opts.categories) {
    const created = await prisma.category.create({ data: { companyId, name: c.name, parentId: c.parent ? categories.get(c.parent) : null } });
    categories.set(c.name, created.id);
  }
  const suppliers = [];
  for (const s of opts.suppliers) suppliers.push(await prisma.supplier.create({ data: { ...s, companyId } }));
  await prisma.customer.createMany({ data: opts.customers.map((c) => ({ ...c, companyId })) });

  const now = Date.now();
  for (const [idx, { stock, category, supplier, ...p }] of opts.products.entries()) {
    const product = await prisma.product.create({
      data: { ...p, companyId, categoryId: categories.get(category), supplierId: suppliers[supplier]?.id },
    });
    for (const [i, qty] of stock.entries()) {
      if (qty <= 0) continue;
      const warehouseId = opts.warehouses[i]!.id;
      await prisma.stock.create({ data: { productId: product.id, warehouseId, quantity: qty } });
      await prisma.stockMovement.create({
        data: {
          companyId,
          type: 'IN',
          productId: product.id,
          warehouseId,
          quantity: qty,
          balanceAfter: qty,
          unitCost: new Prisma.Decimal(p.costPrice),
          note: 'Inventario inicial',
          userId: opts.userId,
          createdAt: new Date(now - (20 - idx) * DAY),
        },
      });
    }
  }
  return true;
}

async function main() {
  // ── Usuarios ─────────────────────────────────────────────
  const admin = await upsertUser('admin@inventario.local', 'Administrador HGV', 'Admin123!', true);
  const gerente = await upsertUser('gerente@inventario.local', 'Gerente de Operaciones', 'Gerente123!');
  const operador = await upsertUser('operador@inventario.local', 'Operador Bodega Santiago', 'Operador123!');
  const consulta = await upsertUser('consulta@inventario.local', 'Usuario de Consulta', 'Consulta123!');
  const sur = await upsertUser('admin@delsur.cl', 'Administradora Del Sur', 'DelSur123!');

  // ── Empresa 1: Comercial Los Andes (2 sucursales) ───────
  const andes = await upsertCompany({
    rut: '77111222-6',
    name: 'Comercial Los Andes SpA',
    tradeName: 'Los Andes Tecnología',
    giro: 'Venta al por mayor de equipos computacionales y artículos de oficina',
    address: 'Av. Providencia 1234',
    city: 'Santiago',
  });
  const stgo = await branch(andes.id, 'STGO', 'Santiago Centro', 'Santiago');
  const anto = await branch(andes.id, 'ANTOF', 'Antofagasta', 'Antofagasta');
  const whStgo =
    (await prisma.warehouse.findFirst({ where: { companyId: andes.id, code: 'STGO-01' } })) ??
    (await prisma.warehouse.create({ data: { companyId: andes.id, branchId: stgo.id, code: 'STGO-01', name: 'Bodega Santiago', address: 'Av. Providencia 1234' } }));
  const whAnto =
    (await prisma.warehouse.findFirst({ where: { companyId: andes.id, code: 'ANTOF-01' } })) ??
    (await prisma.warehouse.create({ data: { companyId: andes.id, branchId: anto.id, code: 'ANTOF-01', name: 'Bodega Antofagasta', address: 'Av. Grecia 456' } }));

  await member(admin.id, andes.id, 'ADMIN');
  await member(gerente.id, andes.id, 'MANAGER');
  await member(operador.id, andes.id, 'OPERATOR', [stgo.id]); // solo sucursal Santiago
  await member(consulta.id, andes.id, 'VIEWER');

  await seedCatalog({
    companyId: andes.id,
    userId: admin.id,
    warehouses: [whStgo, whAnto],
    categories: [{ name: 'Tecnología' }, { name: 'Cómputo', parent: 'Tecnología' }, { name: 'Periféricos', parent: 'Tecnología' }, { name: 'Oficina' }],
    suppliers: [
      { name: 'TecnoDistribuciones SpA', taxId: '76123456-0', contactName: 'Laura Gómez', email: 'ventas@tecnodist.cl', phone: '+56 2 2555 0101' },
      { name: 'Librería y Papelería Global Ltda.', taxId: '77654321-7', contactName: 'Carlos Ruiz', email: 'pedidos@papeleriaglobal.cl', phone: '+56 2 2555 0202' },
    ],
    customers: [
      { name: 'Comercial Andina SpA', taxId: '76987654-5', email: 'compras@andina.cl', phone: '+56 2 2444 1111' },
      { name: 'Fundación Educacional San Martín', taxId: '65432109-4', email: 'logistica@sanmartin.cl', phone: '+56 2 2444 2222' },
      { name: 'Cliente mostrador' },
    ],
    products: [
      { sku: 'LAP-001', barcode: '7800000000011', name: 'Laptop 14" Core i5 16GB', category: 'Cómputo', supplier: 0, costPrice: 520000, salePrice: 699990, minStock: 5, maxStock: 30, stock: [12, 4] },
      { sku: 'LAP-002', barcode: '7800000000028', name: 'Laptop 15" Ryzen 7 32GB', category: 'Cómputo', supplier: 0, costPrice: 780000, salePrice: 989990, minStock: 3, maxStock: 15, stock: [2, 0] },
      { sku: 'MON-24', barcode: '7800000000035', name: 'Monitor 24" IPS Full HD', category: 'Periféricos', supplier: 0, costPrice: 95000, salePrice: 139990, minStock: 8, maxStock: 40, stock: [20, 10] },
      { sku: 'TEC-MEC', barcode: '7800000000042', name: 'Teclado mecánico inalámbrico', category: 'Periféricos', supplier: 0, costPrice: 28000, salePrice: 44990, minStock: 10, maxStock: 60, stock: [35, 15] },
      { sku: 'MOU-ERG', barcode: '7800000000059', name: 'Mouse ergonómico', category: 'Periféricos', supplier: 0, costPrice: 9500, salePrice: 16990, minStock: 15, maxStock: 100, stock: [8, 3] },
      { sku: 'PAP-A4', barcode: '7800000000066', name: 'Papel bond A4 (resma 500 hojas)', category: 'Oficina', supplier: 1, unit: 'RES', costPrice: 3200, salePrice: 4990, minStock: 50, maxStock: 400, stock: [180, 60] },
      { sku: 'SIL-ERG', barcode: '7800000000073', name: 'Silla ergonómica de oficina', category: 'Oficina', supplier: 1, costPrice: 85000, salePrice: 129990, minStock: 4, maxStock: 20, stock: [6, 2] },
      { sku: 'CAP-SEG', barcode: '7800000000097', name: 'Capacitación en seguridad de bodega (cupo)', category: 'Oficina', supplier: 1, unit: 'CUP', costPrice: 25000, salePrice: 45000, minStock: 5, maxStock: 30, taxExempt: true, stock: [10, 4] },
      { sku: 'BOL-AZ', barcode: '7800000000080', name: 'Bolígrafo azul (caja x 50)', category: 'Oficina', supplier: 1, unit: 'CJA', costPrice: 4500, salePrice: 7490, minStock: 20, maxStock: 150, stock: [0, 0] },
    ],
  });

  // ── Empresa 2: Distribuidora Del Sur (1 sucursal) ───────
  const delSur = await upsertCompany({
    rut: '76555444-6',
    name: 'Distribuidora Del Sur Limitada',
    tradeName: 'Del Sur',
    giro: 'Distribución de insumos de aseo y seguridad industrial',
    address: 'Av. Los Carrera 890',
    city: 'Concepción',
  });
  const conce = await branch(delSur.id, 'CONCE', 'Concepción', 'Concepción');
  const whConce =
    (await prisma.warehouse.findFirst({ where: { companyId: delSur.id, code: 'CONCE-01' } })) ??
    (await prisma.warehouse.create({ data: { companyId: delSur.id, branchId: conce.id, code: 'CONCE-01', name: 'Centro de distribución Concepción' } }));

  await member(sur.id, delSur.id, 'ADMIN');
  await member(consulta.id, delSur.id, 'VIEWER'); // el mismo usuario en dos empresas

  await seedCatalog({
    companyId: delSur.id,
    userId: sur.id,
    warehouses: [whConce],
    categories: [{ name: 'Seguridad industrial' }, { name: 'Aseo' }],
    suppliers: [{ name: 'Protección Total SpA', taxId: '78321654-K', email: 'ventas@proteccion.cl' }],
    customers: [{ name: 'Constructora Bío Bío SpA', taxId: '76222333-3' }],
    products: [
      { sku: 'EPP-CAS', barcode: '7801000000010', name: 'Casco de seguridad', category: 'Seguridad industrial', supplier: 0, costPrice: 6500, salePrice: 11990, minStock: 30, maxStock: 200, stock: [120] },
      { sku: 'EPP-GUA', barcode: '7801000000027', name: 'Guantes de nitrilo (par)', category: 'Seguridad industrial', supplier: 0, costPrice: 1200, salePrice: 2490, minStock: 100, maxStock: 800, stock: [60] },
      { sku: 'ASE-DET', barcode: '7801000000034', name: 'Detergente industrial 5 L', category: 'Aseo', supplier: 0, unit: 'BID', costPrice: 7800, salePrice: 12990, minStock: 20, maxStock: 120, stock: [45] },
    ],
  });

  console.log('✅ Datos de demostración listos: 2 empresas, 3 sucursales, 5 usuarios');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
