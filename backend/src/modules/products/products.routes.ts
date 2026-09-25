import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma } from '../../lib/prisma.js';
import { IdParams } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { toCsv } from '../../lib/csv.js';
import { Conflict, NotFound } from '../../lib/errors.js';
import { applyStockChange, inTransaction, movementInclude } from '../inventory/inventory.service.js';
import { MovementOut, MovementsQuery } from '../inventory/inventory.schemas.js';
import { movementsWhere } from '../inventory/inventory.routes.js';
import {
  CreateProductBody,
  ImportProductsBody,
  ListProductsQuery,
  ProductDetailOut,
  ProductOut,
  UpdateProductBody,
} from './products.schemas.js';
import { buildWhere, getProduct, listProducts, lowStockProductIds, productInclude, withStockTotals } from './products.service.js';

export const productsRouter = new ApiRouter('/products', 'Productos')
  .get('/', { summary: 'Listar productos', role: 'VIEWER', query: ListProductsQuery, response: paginatedOf(ProductOut) }, ({ query }) =>
    listProducts(query),
  )
  .get(
    '/export',
    { summary: 'Exportar productos a CSV', role: 'VIEWER', query: ListProductsQuery.omit({ page: true, limit: true }), produces: 'text/csv' },
    async ({ query, res }) => {
      const where = buildWhere(query);
      if (query.lowStock) where.id = { in: await lowStockProductIds() };
      const rows = await withStockTotals(await prisma.product.findMany({ where, include: productInclude, orderBy: { sku: 'asc' } }));
      const csv = toCsv(
        rows.map((p) => ({
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          category: p.category?.name,
          supplier: p.supplier?.name,
          unit: p.unit,
          costPrice: p.costPrice.toString(),
          salePrice: p.salePrice.toString(),
          minStock: p.minStock,
          maxStock: p.maxStock,
          totalStock: p.totalStock,
          isActive: p.isActive ? 'SI' : 'NO',
        })),
        [
          { key: 'sku', header: 'SKU' },
          { key: 'barcode', header: 'Código de barras' },
          { key: 'name', header: 'Nombre' },
          { key: 'category', header: 'Categoría' },
          { key: 'supplier', header: 'Proveedor' },
          { key: 'unit', header: 'Unidad' },
          { key: 'costPrice', header: 'Costo' },
          { key: 'salePrice', header: 'Precio venta' },
          { key: 'minStock', header: 'Stock mínimo' },
          { key: 'maxStock', header: 'Stock máximo' },
          { key: 'totalStock', header: 'Stock total' },
          { key: 'isActive', header: 'Activo' },
        ],
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="productos-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    },
  )
  .get(
    '/lookup',
    { summary: 'Buscar producto por SKU o código de barras', description: 'Útil para lectores de código de barras.', role: 'VIEWER', query: z.object({ code: z.string().trim().min(1) }), response: ProductDetailOut },
    ({ query }) => getProduct({ OR: [{ sku: query.code.toUpperCase() }, { barcode: query.code }] }),
  )
  .post(
    '/import',
    { summary: 'Importación masiva (upsert por SKU)', role: 'MANAGER', body: ImportProductsBody, response: z.object({ created: z.number(), updated: z.number() }) },
    async ({ req, body }) => {
      const skus = body.products.map((p) => p.sku);
      if (new Set(skus).size !== skus.length) throw Conflict('Hay SKUs duplicados en el archivo');
      const existing = new Set((await prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true } })).map((p) => p.sku));
      await prisma.$transaction(
        body.products.map((p) => prisma.product.upsert({ where: { sku: p.sku }, create: p, update: { ...p, deletedAt: null } })),
      );
      const result = { created: skus.length - existing.size, updated: existing.size };
      await audit(req, { action: 'IMPORT', entity: 'Product', changes: result });
      return result;
    },
  )
  .get('/:id', { summary: 'Obtener producto con existencias por almacén', role: 'VIEWER', params: IdParams, response: ProductDetailOut }, ({ params }) =>
    getProduct({ id: params.id }),
  )
  .get(
    '/:id/movements',
    { summary: 'Kardex del producto', role: 'VIEWER', params: IdParams, query: MovementsQuery.omit({ productId: true }), response: paginatedOf(MovementOut) },
    async ({ params, query }) => {
      const where = movementsWhere({ ...query, productId: params.id });
      const [data, total] = await Promise.all([
        prisma.stockMovement.findMany({ where, include: movementInclude, orderBy: orderArgs(query, ['createdAt'], 'createdAt'), ...pageArgs(query) }),
        prisma.stockMovement.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .post('/', { summary: 'Crear producto', role: 'MANAGER', body: CreateProductBody, response: ProductDetailOut, status: 201 }, async ({ req, body }) => {
    const { initialStock, ...data } = body;
    const product = await inTransaction(async (tx) => {
      const created = await tx.product.create({ data });
      if (initialStock) {
        await applyStockChange(tx, {
          type: 'IN',
          productId: created.id,
          warehouseId: initialStock.warehouseId,
          delta: initialStock.quantity,
          unitCost: data.costPrice,
          note: 'Stock inicial',
          userId: req.auth?.userId,
        });
      }
      return created;
    });
    await audit(req, { action: 'CREATE', entity: 'Product', entityId: product.id, changes: body });
    return getProduct({ id: product.id });
  })
  .patch(
    '/:id',
    { summary: 'Actualizar producto', role: 'MANAGER', params: IdParams, body: UpdateProductBody, response: ProductDetailOut },
    async ({ req, params, body }) => {
      const before = await prisma.product.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!before) throw NotFound('Producto');
      await prisma.product.update({ where: { id: params.id }, data: body });
      await audit(req, { action: 'UPDATE', entity: 'Product', entityId: params.id, changes: body });
      return getProduct({ id: params.id });
    },
  )
  .delete(
    '/:id',
    { summary: 'Eliminar producto', description: 'Borrado lógico. Solo si no tiene existencias.', role: 'MANAGER', params: IdParams },
    async ({ req, params }) => {
      const product = await getProduct({ id: params.id });
      if (product.totalStock > 0) throw Conflict(`El producto aún tiene ${product.totalStock} unidades en stock`);
      await prisma.product.update({ where: { id: params.id }, data: { deletedAt: new Date(), isActive: false } });
      await audit(req, { action: 'DELETE', entity: 'Product', entityId: params.id });
    },
  );
