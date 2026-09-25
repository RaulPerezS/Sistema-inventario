import type { Request } from 'express';
import { prisma, Prisma, type Tx } from './prisma.js';
import { Forbidden, NotFound, Unprocessable } from './errors.js';

export interface Tenant {
  companyId: string;
  /** Sucursales permitidas; null = todas. */
  branchIds: string[] | null;
  userId: string | null;
}

/** Empresa activa de la petición. Toda consulta de negocio debe filtrarse por ella. */
export function tenant(req: Request): Tenant {
  const auth = req.auth;
  if (!auth?.companyId) throw Forbidden('Seleccione una empresa para operar');
  return { companyId: auth.companyId, branchIds: auth.branchIds, userId: auth.userId };
}

/** Filtro de almacenes visibles para el usuario (empresa + sucursales permitidas). */
export function warehouseScope(t: Tenant): Prisma.WarehouseWhereInput {
  return { companyId: t.companyId, ...(t.branchIds && { branchId: { in: t.branchIds } }) };
}

/**
 * IDs de almacenes permitidos, o null si el usuario ve todas las sucursales.
 * Se calcula una vez por petición.
 */
export async function allowedWarehouseIds(req: Request): Promise<string[] | null> {
  if (req.allowedWarehouses !== undefined) return req.allowedWarehouses;
  const t = tenant(req);
  req.allowedWarehouses = t.branchIds
    ? (await prisma.warehouse.findMany({ where: warehouseScope(t), select: { id: true } })).map((w) => w.id)
    : null;
  return req.allowedWarehouses;
}

/** Filtro Prisma por almacén para entidades con `warehouseId` (stock, movimientos, órdenes). */
export async function warehouseFilter(req: Request, requested?: string): Promise<{ warehouseId?: string | { in: string[] } }> {
  const allowed = await allowedWarehouseIds(req);
  if (requested) {
    if (allowed && !allowed.includes(requested)) throw Forbidden('No tiene acceso a ese almacén');
    return { warehouseId: requested };
  }
  return allowed ? { warehouseId: { in: allowed } } : {};
}

/** Fragmento SQL para consultas crudas: `AND <alias>."warehouseId" = ANY(...)` si hay restricción. */
export async function sqlWarehouseScope(req: Request, alias: string, requested?: string): Promise<Prisma.Sql> {
  const col = Prisma.raw(`${alias}."warehouseId"`);
  const allowed = await allowedWarehouseIds(req);
  if (requested) {
    if (allowed && !allowed.includes(requested)) throw Forbidden('No tiene acceso a ese almacén');
    return Prisma.sql`AND ${col} = ${requested}::uuid`;
  }
  if (!allowed) return Prisma.empty;
  if (allowed.length === 0) return Prisma.sql`AND false`;
  return Prisma.sql`AND ${col} = ANY(ARRAY[${Prisma.join(allowed.map((id) => Prisma.sql`${id}::uuid`))}])`;
}

/** Verifica que el almacén pertenezca a la empresa, a una sucursal permitida y esté activo. */
export async function assertWarehouse(tx: Tx, t: Tenant, warehouseId: string, { requireActive = true } = {}) {
  const w = await tx.warehouse.findFirst({ where: { id: warehouseId, companyId: t.companyId }, include: { branch: { select: { isActive: true } } } });
  if (!w) throw NotFound('Almacén');
  if (t.branchIds && !t.branchIds.includes(w.branchId)) throw Forbidden('No tiene acceso a la sucursal de ese almacén');
  if (requireActive && (!w.isActive || !w.branch.isActive)) throw Unprocessable('El almacén o su sucursal están inactivos');
  return w;
}

