import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { sha256 } from '../lib/crypto.js';
import { Forbidden, Unauthorized } from '../lib/errors.js';

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, MANAGER: 2, ADMIN: 3 };

const branchScope = (ids: string[]) => (ids.length ? ids : null);

/**
 * Autentica la petición mediante:
 *  - `Authorization: Bearer <jwt>` (usuarios del panel / apps)
 *  - `X-API-Key: <clave>` (integraciones de sistemas externos)
 * y resuelve la empresa activa, el rol efectivo y las sucursales permitidas.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');
  if (apiKey) {
    const key = await prisma.apiKey.findUnique({ where: { keyHash: sha256(apiKey) }, include: { company: { select: { isActive: true } } } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) {
      throw Unauthorized('API key inválida, revocada o expirada');
    }
    if (!key.company.isActive) throw Forbidden('La empresa de esta API key está desactivada');
    // Actualización "fire-and-forget" del último uso
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    req.auth = { userId: null, apiKeyId: key.id, role: key.role, companyId: key.companyId, branchIds: branchScope(key.branchIds), isSuperAdmin: false, via: 'api_key' };
    return next();
  }

  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw Unauthorized('Token de acceso requerido');

  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    throw Unauthorized('Token inválido o expirado');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, isActive: true, isSuperAdmin: true } });
  if (!user || !user.isActive) throw Unauthorized('Usuario inactivo o inexistente');

  const base = { userId: user.id, apiKeyId: null, email: user.email, isSuperAdmin: user.isSuperAdmin, via: 'jwt' as const };
  if (!payload.companyId) {
    req.auth = { ...base, role: user.isSuperAdmin ? 'ADMIN' : 'VIEWER', companyId: null, branchIds: null };
    return next();
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: user.id, companyId: payload.companyId } },
    include: { company: { select: { isActive: true } } },
  });
  if (membership?.isActive && membership.company.isActive) {
    req.auth = { ...base, role: membership.role, companyId: payload.companyId, branchIds: branchScope(membership.branchIds) };
  } else if (user.isSuperAdmin) {
    // El administrador de plataforma puede operar cualquier empresa con todos los permisos
    req.auth = { ...base, role: 'ADMIN', companyId: payload.companyId, branchIds: null };
  } else {
    throw Forbidden('Ya no tiene acceso a esta empresa');
  }
  next();
}

/** Exige un rol mínimo (jerárquico): VIEWER < OPERATOR < MANAGER < ADMIN. */
export function authorize(minRole: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw Unauthorized();
    if (ROLE_RANK[req.auth.role] < ROLE_RANK[minRole]) throw Forbidden();
    next();
  };
}

/** Exige ser administrador de la plataforma (gestión de empresas). */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.isSuperAdmin) throw Forbidden('Solo el administrador de la plataforma puede realizar esta acción');
  next();
}

/** Exige autenticación por usuario (no API key). */
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.userId) throw Forbidden('Esta operación requiere un usuario autenticado');
  next();
}
