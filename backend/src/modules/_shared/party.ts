import { z } from '../../docs/zod.js';
import { isValidRut, normalizeRut } from '../../lib/rut.js';
import { IdParams, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { orderArgs, pageArgs, paginated, PaginationQuery, QueryBool } from '../../lib/pagination.js';
import { paginatedOf } from '../../docs/registry.js';
import { ApiRouter } from '../../lib/router.js';
import { audit } from '../../lib/audit.js';
import { Conflict, NotFound } from '../../lib/errors.js';
import { tenant } from '../../lib/tenant.js';

export const partyFields = {
  name: z.string().trim().min(2).max(150),
  taxId: optionalText(20)
    .refine((v) => v == null || isValidRut(v), 'RUT inválido (verifique el dígito verificador)')
    .transform((v) => (v == null ? v : normalizeRut(v)))
    .openapi({ type: 'string', description: 'RUT chileno (único por empresa). Acepta "12.345.678-5" o "123456785"; se almacena como "12345678-5".', example: '76.123.456-0' }),
  email: z.string().trim().email().nullish().or(z.literal('').transform(() => null)),
  phone: optionalText(40),
  address: optionalText(300),
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
};

export const PartyOut = {
  id: z.string().uuid(),
  name: z.string(),
  taxId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  ...Timestamps,
};

// Delegado mínimo común a prisma.supplier / prisma.customer
interface PartyDelegate {
  findMany(args: unknown): Promise<unknown[]>;
  findFirst(args: unknown): Promise<unknown | null>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<{ id: string }>;
  update(args: unknown): Promise<{ id: string }>;
  delete(args: unknown): Promise<unknown>;
}

interface PartyConfig {
  basePath: string;
  tag: string;
  entity: string;
  label: string;
  delegate: PartyDelegate;
  body: z.ZodObject<z.ZodRawShape>;
  out: z.ZodTypeAny;
  /** Cuenta referencias que impiden el borrado físico. */
  references: (id: string) => Promise<number>;
}

export function partyRouter(cfg: PartyConfig) {
  const ListQuery = PaginationQuery.extend({ isActive: QueryBool.optional() });
  const find = async (companyId: string, id: string) => {
    const item = await cfg.delegate.findFirst({ where: { id, companyId } });
    if (!item) throw NotFound(cfg.entity === 'Supplier' ? 'Proveedor' : 'Cliente');
    return item;
  };
  return new ApiRouter(cfg.basePath, cfg.tag)
    .get('/', { summary: `Listar ${cfg.tag.toLowerCase()}`, role: 'VIEWER', query: ListQuery, response: paginatedOf(cfg.out) }, async ({ req, query }) => {
      const where = {
        companyId: tenant(req).companyId,
        isActive: query.isActive,
        ...(query.search && {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { taxId: { contains: query.search.replace(/\./g, ''), mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      };
      const [data, total] = await Promise.all([
        cfg.delegate.findMany({ where, orderBy: orderArgs(query, ['name', 'createdAt'], 'name'), ...pageArgs(query) }),
        cfg.delegate.count({ where }),
      ]);
      return paginated(data, total, query);
    })
    .get('/:id', { summary: `Obtener ${cfg.label}`, role: 'VIEWER', params: IdParams, response: cfg.out }, async ({ req, params }) => find(tenant(req).companyId, params.id))
    .post('/', { summary: `Crear ${cfg.label}`, role: 'MANAGER', body: cfg.body, response: cfg.out, status: 201 }, async ({ req, body }) => {
      const item = await cfg.delegate.create({ data: { ...body, companyId: tenant(req).companyId } });
      await audit(req, { action: 'CREATE', entity: cfg.entity, entityId: item.id, changes: body });
      return item;
    })
    .patch(
      '/:id',
      { summary: `Actualizar ${cfg.label}`, role: 'MANAGER', params: IdParams, body: cfg.body.partial(), response: cfg.out },
      async ({ req, params, body }) => {
        await find(tenant(req).companyId, params.id);
        const item = await cfg.delegate.update({ where: { id: params.id }, data: body });
        await audit(req, { action: 'UPDATE', entity: cfg.entity, entityId: item.id, changes: body });
        return item;
      },
    )
    .delete(
      '/:id',
      { summary: `Eliminar ${cfg.label}`, description: 'Solo si no tiene documentos asociados; en ese caso desactívelo.', role: 'MANAGER', params: IdParams },
      async ({ req, params }) => {
        await find(tenant(req).companyId, params.id);
        const refs = await cfg.references(params.id);
        if (refs > 0) throw Conflict(`No se puede eliminar: tiene ${refs} registro(s) asociados. Desactívelo en su lugar.`);
        await cfg.delegate.delete({ where: { id: params.id } });
        await audit(req, { action: 'DELETE', entity: cfg.entity, entityId: params.id });
      },
    );
}
