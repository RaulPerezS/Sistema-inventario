import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { signAccessToken } from '../../lib/jwt.js';
import { BadRequest, Unauthorized } from '../../lib/errors.js';
import { userSelect } from '../users/users.schemas.js';

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

async function issueTokens(user: { id: string; email: string; role: import('@prisma/client').Role }, client: ClientInfo) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { tokenHash: sha256(refreshToken), userId: user.id, expiresAt, ip: client.ip, userAgent: client.userAgent?.slice(0, 255) },
  });
  return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt, tokenType: 'Bearer' as const, expiresIn: env.JWT_ACCESS_EXPIRES_IN };
}

export async function login(email: string, password: string, client: ClientInfo) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Mismo mensaje para usuario inexistente o contraseña incorrecta (evita enumeración)
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw Unauthorized('Credenciales inválidas');
  if (!user.isActive) throw Unauthorized('Usuario desactivado');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const tokens = await issueTokens(user, client);
  const { passwordHash: _omit, ...safeUser } = user;
  void _omit;
  return { user: safeUser, ...tokens };
}

/** Rotación de refresh tokens: cada uso invalida el anterior y emite uno nuevo. */
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
  const tokens = await issueTokens(stored.user, client);
  const { passwordHash: _omit, ...safeUser } = stored.user;
  void _omit;
  return { user: safeUser, ...tokens };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function logoutAll(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!user) throw Unauthorized();
  return user;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw BadRequest('La contraseña actual es incorrecta');
  if (currentPassword === newPassword) throw BadRequest('La nueva contraseña debe ser distinta a la actual');
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await logoutAll(userId);
}
