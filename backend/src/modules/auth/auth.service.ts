import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { signAccessToken } from '../../lib/jwt.js';
import { BadRequest, Forbidden, NotFound, Unauthorized } from '../../lib/errors.js';
import { userSelect } from '../users/users.schemas.js';

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

interface SessionUser {
  id: string;
  email: string;
  isSuperAdmin: boolean;
}

/**
 * Determina la empresa con la que opera la sesión:
 * la solicitada (si tiene acceso), o la primera a la que pertenece.
 */
async function resolveCompany(user: SessionUser, requested?: string | null): Promise<string | null> {
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, isActive: true, company: { isActive: true } },
    include: { company: { select: { name: true } } },
    orderBy: { company: { name: 'asc' } },
  });
  if (requested) {
    if (memberships.some((m) => m.companyId === requested)) return requested;
    if (user.isSuperAdmin) {
      if (!(await prisma.company.findUnique({ where: { id: requested } }))) throw NotFound('Empresa');
      return requested;
    }
    throw Forbidden('No tiene acceso a esa empresa');
  }
  if (memberships[0]) return memberships[0].companyId;
  if (user.isSuperAdmin) return (await prisma.company.findFirst({ where: { isActive: true }, orderBy: { name: 'asc' } }))?.id ?? null;
  throw Forbidden('El usuario no tiene empresas asignadas o están desactivadas');
}

/** Perfil de la sesión: usuario, empresa activa, rol, sucursales permitidas y empresas disponibles. */
export async function sessionProfile(userId: string, companyId: string | null) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!user) throw Unauthorized();

  const memberships = await prisma.membership.findMany({
    where: { userId, isActive: true, company: { isActive: true } },
    include: { company: { select: { id: true, name: true, tradeName: true, rut: true } } },
    orderBy: { company: { name: 'asc' } },
  });
  // El administrador de plataforma puede entrar a cualquier empresa
  const companies = user.isSuperAdmin
    ? (await prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true, tradeName: true, rut: true }, orderBy: { name: 'asc' } })).map((c) => ({
        ...c,
        role: (memberships.find((m) => m.companyId === c.id)?.role ?? 'ADMIN') as Role,
      }))
    : memberships.map((m) => ({ ...m.company, role: m.role }));

  const company = companyId
    ? await prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true, tradeName: true, rut: true, giro: true, taxRate: true },
      })
    : null;
  const current = memberships.find((m) => m.companyId === companyId);
  const branchIds = current?.branchIds.length ? current.branchIds : null;
  const branches = company
    ? await prisma.branch.findMany({
        where: { companyId: company.id, isActive: true, ...(branchIds && { id: { in: branchIds } }) },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      })
    : [];

  return { user, company, role: (current?.role ?? (user.isSuperAdmin ? 'ADMIN' : 'VIEWER')) as Role, branchIds, branches, companies };
}

async function issueTokens(user: SessionUser, companyId: string | null, client: ClientInfo) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, companyId });
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { tokenHash: sha256(refreshToken), userId: user.id, companyId, expiresAt, ip: client.ip, userAgent: client.userAgent?.slice(0, 255) },
  });
  return {
    ...(await sessionProfile(user.id, companyId)),
    accessToken,
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
    tokenType: 'Bearer' as const,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  };
}

export async function login(email: string, password: string, companyId: string | undefined, client: ClientInfo) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Mismo mensaje para usuario inexistente o contraseña incorrecta (evita enumeración)
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw Unauthorized('Credenciales inválidas');
  if (!user.isActive) throw Unauthorized('Usuario desactivado');

  const activeCompany = await resolveCompany(user, companyId);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueTokens(user, activeCompany, client);
}

/** Rotación de refresh tokens: cada uso invalida el anterior y emite uno nuevo (misma empresa). */
export async function refresh(refreshToken: string, client: ClientInfo) {
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
  if (!stored) throw Unauthorized('Refresh token inválido');

  if (stored.revokedAt) {
    // Reutilización de un token ya rotado: posible robo → se revocan todas las sesiones del usuario
    await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw Unauthorized('Refresh token reutilizado; todas las sesiones fueron cerradas');
  }
  if (stored.expiresAt < new Date()) throw Unauthorized('Refresh token expirado');
  if (!stored.user.isActive) throw Unauthorized('Usuario desactivado');

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  // Si perdió el acceso a la empresa de la sesión, cae a otra disponible
  const companyId = await resolveCompany(stored.user, stored.companyId).catch(() => resolveCompany(stored.user));
  return issueTokens(stored.user, companyId, client);
}

/** Cambia la empresa activa emitiendo nuevos tokens (revoca el refresh token anterior si se envía). */
export async function switchCompany(userId: string, companyId: string, currentRefresh: string | undefined, client: ClientInfo) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const target = await resolveCompany(user, companyId);
  if (currentRefresh) await logout(currentRefresh);
  return issueTokens(user, target, client);
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function logoutAll(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw BadRequest('La contraseña actual es incorrecta');
  if (currentPassword === newPassword) throw BadRequest('La nueva contraseña debe ser distinta a la actual');
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await logoutAll(userId);
}
