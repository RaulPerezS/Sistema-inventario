import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { IdParams, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { audit } from '../../lib/audit.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';

const CategoryOut = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    parentId: z.string().uuid().nullable(),
    parent: z.object({ id: z.string(), name: z.string() }).nullable(),
    _count: z.object({ products: z.number(), children: z.number() }),
    ...Timestamps,
  })
  .openapi('Category');

const CategoryBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: optionalText(),
    parentId: z.string().uuid().nullish(),
  })
  .openapi('CategoryInput');

const include = { parent: { select: { id: true, name: true } }, _count: { select: { products: true, children: true } } } as const;

async function assertValidParent(id: string | undefined, parentId: string | null | undefined) {
  if (!parentId) return;
  if (parentId === id) throw BadRequest('Una categoría no puede ser su propia padre');
  // Evita ciclos recorriendo los ancestros
  let current: string | null = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === id || seen.has(current)) throw BadRequest('La jerarquía de categorías generaría un ciclo');
    seen.add(current);
    const parent: { parentId: string | null } | null = await prisma.category.findUnique({ where: { id: current }, select: { parentId: true } });
    if (!parent) throw NotFound('Categoría padre');
    current = parent.parentId;
  }
}

export const categoriesRouter = new ApiRouter('/categories', 'Categorías')
  .get(
    '/',
    { summary: 'Listar categorías', role: 'VIEWER', query: PaginationQuery.extend({ parentId: z.string().uuid().optional() }), response: paginatedOf(CategoryOut) },
    async ({ query }) => {
      const where: Prisma.CategoryWhereInput = {
        parentId: query.parentId,
        ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
      };
      const [data, total] = await Promise.all([
        prisma.category.findMany({ where, include, orderBy: orderArgs(query, ['name', 'createdAt'], 'name'), ...pageArgs(query) }),
        prisma.category.count({ where }),
      ]);
      return paginated(data, total, query);
    },
  )
  .get('/:id', { summary: 'Obtener categoría', role: 'VIEWER', params: IdParams, response: CategoryOut }, async ({ params }) => {
    const category = await prisma.category.findUnique({ where: { id: params.id }, include });
    if (!category) throw NotFound('Categoría');
    return category;
  })
  .post('/', { summary: 'Crear categoría', role: 'MANAGER', body: CategoryBody, response: CategoryOut, status: 201 }, async ({ req, body }) => {
    await assertValidParent(undefined, body.parentId);
    const category = await prisma.category.create({ data: body, include });
    await audit(req, { action: 'CREATE', entity: 'Category', entityId: category.id, changes: body });
    return category;
  })
  .patch(
    '/:id',
    { summary: 'Actualizar categoría', role: 'MANAGER', params: IdParams, body: CategoryBody.partial(), response: CategoryOut },
    async ({ req, params, body }) => {
      await assertValidParent(params.id, body.parentId);
      const category = await prisma.category.update({ where: { id: params.id }, data: body, include });
      await audit(req, { action: 'UPDATE', entity: 'Category', entityId: category.id, changes: body });
      return category;
    },
  )
  .delete('/:id', { summary: 'Eliminar categoría', description: 'Solo si no tiene productos asociados.', role: 'MANAGER', params: IdParams }, async ({ req, params }) => {
    const products = await prisma.product.count({ where: { categoryId: params.id, deletedAt: null } });
    if (products > 0) throw Conflict(`La categoría tiene ${products} producto(s) asociados`);
    await prisma.category.delete({ where: { id: params.id } });
    await audit(req, { action: 'DELETE', entity: 'Category', entityId: params.id });
  });
