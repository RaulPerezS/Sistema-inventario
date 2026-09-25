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
    prisma.warehouse.create({ data: { code: 'CENTRAL', name: 'Bodega Central', address: 'Av. Providencia 1234, Providencia, Santiago' } }),
    prisma.warehouse.create({ data: { code: 'NORTE', name: 'Sucursal Antofagasta', address: 'Av. Grecia 456, Antofagasta' } }),
  ]);

  const tech = await prisma.category.create({ data: { name: 'Tecnología', description: 'Equipos y accesorios' } });
  const [computo, perifericos] = await Promise.all([
    prisma.category.create({ data: { name: 'Cómputo', parentId: tech.id } }),
    prisma.category.create({ data: { name: 'Periféricos', parentId: tech.id } }),
  ]);
  const oficina = await prisma.category.create({ data: { name: 'Oficina', description: 'Útiles y mobiliario' } });

  const [proveedorTech, proveedorOfi] = await Promise.all([
    prisma.supplier.create({ data: { name: 'TecnoDistribuciones SpA', taxId: '76123456-0', contactName: 'Laura Gómez', email: 'ventas@tecnodist.cl', phone: '+56 2 2555 0101' } }),
    prisma.supplier.create({ data: { name: 'Librería y Papelería Global Ltda.', taxId: '77654321-7', contactName: 'Carlos Ruiz', email: 'pedidos@papeleriaglobal.cl', phone: '+56 2 2555 0202' } }),
  ]);

  await prisma.customer.createMany({
    data: [
      { name: 'Comercial Andina SpA', taxId: '76987654-5', email: 'compras@andina.cl', phone: '+56 2 2444 1111' },
      { name: 'Fundación Educacional San Martín', taxId: '65432109-4', email: 'logistica@sanmartin.cl', phone: '+56 2 2444 2222' },
      { name: 'Cliente mostrador' },
    ],
  });

  const catalog = [
    { sku: 'LAP-001', barcode: '7800000000011', name: 'Laptop 14" Core i5 16GB', categoryId: computo.id, supplierId: proveedorTech.id, costPrice: 520000, salePrice: 699990, minStock: 5, maxStock: 30, stock: [12, 4] },
    { sku: 'LAP-002', barcode: '7800000000028', name: 'Laptop 15" Ryzen 7 32GB', categoryId: computo.id, supplierId: proveedorTech.id, costPrice: 780000, salePrice: 989990, minStock: 3, maxStock: 15, stock: [2, 0] },
    { sku: 'MON-24', barcode: '7800000000035', name: 'Monitor 24" IPS Full HD', categoryId: perifericos.id, supplierId: proveedorTech.id, costPrice: 95000, salePrice: 139990, minStock: 8, maxStock: 40, stock: [20, 10] },
    { sku: 'TEC-MEC', barcode: '7800000000042', name: 'Teclado mecánico inalámbrico', categoryId: perifericos.id, supplierId: proveedorTech.id, costPrice: 28000, salePrice: 44990, minStock: 10, maxStock: 60, stock: [35, 15] },
    { sku: 'MOU-ERG', barcode: '7800000000059', name: 'Mouse ergonómico', categoryId: perifericos.id, supplierId: proveedorTech.id, costPrice: 9500, salePrice: 16990, minStock: 15, maxStock: 100, stock: [8, 3] },
    { sku: 'PAP-A4', barcode: '7800000000066', name: 'Papel bond A4 (paquete 500 hojas)', categoryId: oficina.id, supplierId: proveedorOfi.id, unit: 'PAQ', costPrice: 3200, salePrice: 4990, minStock: 50, maxStock: 400, stock: [180, 60] },
    { sku: 'SIL-ERG', barcode: '7800000000073', name: 'Silla ergonómica de oficina', categoryId: oficina.id, supplierId: proveedorOfi.id, costPrice: 85000, salePrice: 129990, minStock: 4, maxStock: 20, stock: [6, 2] },
    { sku: 'CAP-SEG', barcode: '7800000000097', name: 'Capacitación en seguridad de bodega (cupo, exento de IVA)', categoryId: oficina.id, supplierId: proveedorOfi.id, unit: 'CUP', costPrice: 25000, salePrice: 45000, minStock: 5, maxStock: 30, taxExempt: true, stock: [10, 4] },
    { sku: 'BOL-AZ', barcode: '7800000000080', name: 'Bolígrafo azul (caja x 50)', categoryId: oficina.id, supplierId: proveedorOfi.id, unit: 'CJA', costPrice: 4500, salePrice: 7490, minStock: 20, maxStock: 150, stock: [0, 0] },
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
