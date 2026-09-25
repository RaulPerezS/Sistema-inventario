import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { sha256 } from '../lib/crypto.js';
import { Forbidden, Unauthorized } from '../lib/errors.js';

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, MANAGER: 2, ADMIN: 3 };

/**
 * Autentica la petición mediante:
 *  - `Authorization: Bearer <jwt>` (usuarios del panel / apps)
 *  - `X-API-Key: <clave>` (integraciones de sistemas externos)
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');
  if (apiKey) {
    const key = await prisma.apiKey.findUnique({ where: { keyHash: sha256(apiKey) } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) {
      throw Unauthorized('API key inválida, revocada o expirada');
    }
    // Actualización "fire-and-forget" del último uso
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    req.auth = { userId: null, apiKeyId: key.id, role: key.role, via: 'api_key' };
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

  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, role: true, isActive: true } });
  if (!user || !user.isActive) throw Unauthorized('Usuario inactivo o inexistente');

  req.auth = { userId: user.id, apiKeyId: null, role: user.role, email: user.email, via: 'jwt' };
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

/** Exige autenticación por usuario (no API key). */
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.userId) throw Forbidden('Esta operación requiere un usuario autenticado');
  next();
}
