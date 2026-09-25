/* Datos de demostración. Ejecutar con: npm run db:seed */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hash = (p: string) => bcrypt.hash(p, 10);

  const users = [
    { email: 'admin@inventario.local', name: 'Administrador', role: 'ADMIN' as const, password: 'Admin123!' },
    { email: 'gerente@inventario.local', name: 'Gerente de Operaciones', role: 'MANAGER' as const, password: 'Gerente123!' },
    { email: 'operador@inventario.local', name: 'Operador de Almacén', role: 'OPERATOR' as const, password: 'Operador123!' },
    { email: 'consulta@inventario.local', name: 'Usuario de Consulta', role: 'VIEWER' as const, password: 'Consulta123!' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash: await hash(u.password) },
    });
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@inventario.local' } });

  if ((await prisma.product.count()) > 0) {
    console.log('ℹ️  Ya existen productos; se omiten los datos de catálogo.');
    return;
  }

  const [central, norte] = await Promise.all([
    prisma.warehouse.create({ data: { code: 'CENTRAL', name: 'Almacén Central', address: 'Av. Principal 123' } }),
    prisma.warehouse.create({ data: { code: 'NORTE', name: 'Sucursal Norte', address: 'Calle Norte 456' } }),
  ]);

  const tech = await prisma.category.create({ data: { name: 'Tecnología', description: 'Equipos y accesorios' } });
  const [computo, perifericos] = await Promise.all([
    prisma.category.create({ data: { name: 'Cómputo', parentId: tech.id } }),
    prisma.category.create({ data: { name: 'Periféricos', parentId: tech.id } }),
  ]);
  const oficina = await prisma.category.create({ data: { name: 'Oficina', description: 'Útiles y mobiliario' } });

  const [proveedorTech, proveedorOfi] = await Promise.all([
    prisma.supplier.create({ data: { name: 'TecnoDistribuciones S.A.', taxId: '20123456789', contactName: 'Laura Gómez', email: 'ventas@tecnodist.com', phone: '+51 1 555 0101' } }),
    prisma.supplier.create({ data: { name: 'Papelería Global', taxId: '20987654321', contactName: 'Carlos Ruiz', email: 'pedidos@papeleriaglobal.com', phone: '+51 1 555 0202' } }),
  ]);

  await prisma.customer.createMany({
    data: [
      { name: 'Comercial Andina S.A.C.', taxId: '20111222333', email: 'compras@andina.com', phone: '+51 1 444 1111' },
      { name: 'Colegio San Martín', taxId: '20444555666', email: 'logistica@sanmartin.edu', phone: '+51 1 444 2222' },
      { name: 'Cliente mostrador' },
    ],
  });

  const catalog = [
    { sku: 'LAP-001', barcode: '7750000000011', name: 'Laptop 14" Core i5 16GB', categoryId: computo.id, supplierId: proveedorTech.id, costPrice: 2400, salePrice: 3199, minStock: 5, maxStock: 30, stock: [12, 4] },
    { sku: 'LAP-002', barcode: '7750000000028', name: 'Laptop 15" Ryzen 7 32GB', categoryId: computo.id, supplierId: proveedorTech.id, costPrice: 3500, salePrice: 4499, minStock: 3, maxStock: 15, stock: [2, 0] },
    { sku: 'MON-24', barcode: '7750000000035', name: 'Monitor 24" IPS Full HD', categoryId: perifericos.id, supplierId: proveedorTech.id, costPrice: 450, salePrice: 649, minStock: 8, maxStock: 40, stock: [20, 10] },
    { sku: 'TEC-MEC', barcode: '7750000000042', name: 'Teclado mecánico inalámbrico', categoryId: perifericos.id, supplierId: proveedorTech.id, costPrice: 120, salePrice: 199, minStock: 10, maxStock: 60, stock: [35, 15] },
    { sku: 'MOU-ERG', barcode: '7750000000059', name: 'Mouse ergonómico', categoryId: perifericos.id, supplierId: proveedorTech.id, costPrice: 45, salePrice: 79, minStock: 15, maxStock: 100, stock: [8, 3] },
    { sku: 'PAP-A4', barcode: '7750000000066', name: 'Papel bond A4 (paquete 500 hojas)', categoryId: oficina.id, supplierId: proveedorOfi.id, unit: 'PAQ', costPrice: 14, salePrice: 21.5, minStock: 50, maxStock: 400, stock: [180, 60] },
    { sku: 'SIL-ERG', barcode: '7750000000073', name: 'Silla ergonómica de oficina', categoryId: oficina.id, supplierId: proveedorOfi.id, costPrice: 380, salePrice: 590, minStock: 4, maxStock: 20, stock: [6, 2] },
    { sku: 'BOL-AZ', barcode: '7750000000080', name: 'Bolígrafo azul (caja x 50)', categoryId: oficina.id, supplierId: proveedorOfi.id, unit: 'CJA', costPrice: 18, salePrice: 29.9, minStock: 20, maxStock: 150, stock: [0, 0] },
  ];

  const now = Date.now();
  for (const [idx, { stock, ...p }] of catalog.entries()) {
    const product = await prisma.product.create({ data: p });
    for (const [i, qty] of stock.entries()) {
      if (qty <= 0) continue;
      const warehouseId = i === 0 ? central.id : norte.id;
      await prisma.stock.create({ data: { productId: product.id, warehouseId, quantity: qty } });
      await prisma.stockMovement.create({
        data: {
          type: 'IN',
          productId: product.id,
          warehouseId,
          quantity: qty,
          balanceAfter: qty,
          unitCost: new Prisma.Decimal(p.costPrice),
          note: 'Inventario inicial',
          userId: admin.id,
          createdAt: new Date(now - (20 - idx) * 86_400_000),
        },
      });
    }
  }

  console.log('✅ Datos de demostración creados');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
