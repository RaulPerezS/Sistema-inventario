import type { CookieOptions, Request, Response } from 'express';
import { z } from '../../docs/zod.js';
import { ApiRouter } from '../../lib/router.js';
import { isProd, env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { Unauthorized } from '../../lib/errors.js';
import { requireUser } from '../../middleware/auth.js';
import { Password, RoleEnum } from '../users/users.schemas.js';
import * as service from './auth.service.js';

const REFRESH_COOKIE = 'refresh_token';
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
};

const LoginBody = z
  .object({
    email: z.string().trim().toLowerCase().email().openapi({ example: 'admin@inventario.local' }),
    password: z.string().min(1).openapi({ example: 'Admin123!' }),
    companyId: z.string().uuid().optional().openapi({ description: 'Empresa con la que iniciar; por defecto, la primera disponible' }),
  })
  .openapi('LoginRequest');

const CompanyRef = z.object({ id: z.string().uuid(), name: z.string(), tradeName: z.string().nullable(), rut: z.string() });

export const SessionProfile = z
  .object({
    user: z.object({
      id: z.string().uuid(),
      email: z.string(),
      name: z.string(),
      isSuperAdmin: z.boolean(),
      isActive: z.boolean(),
      lastLoginAt: z.string().datetime().nullable(),
    }),
    company: CompanyRef.extend({ giro: z.string().nullable(), taxRate: z.string() }).nullable().openapi({ description: 'Empresa activa' }),
    role: RoleEnum.openapi({ description: 'Rol en la empresa activa' }),
    branchIds: z.array(z.string().uuid()).nullable().openapi({ description: 'Sucursales permitidas; null = todas' }),
    branches: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })).openapi({ description: 'Sucursales accesibles' }),
    companies: z.array(CompanyRef.extend({ role: RoleEnum })).openapi({ description: 'Empresas a las que puede cambiar' }),
  })
  .openapi('SessionProfile');

const TokenResponse = SessionProfile.extend({
    accessToken: z.string(),
    refreshToken: z.string().openapi({ description: 'También se envía como cookie httpOnly' }),
    refreshTokenExpiresAt: z.string().datetime(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.string().openapi({ example: '15m' }),
}).openapi('TokenResponse');

const RefreshBody = z.object({
  refreshToken: z.string().optional().openapi({ description: 'Opcional si se envía la cookie `refresh_token`' }),
});

const ChangePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: Password }).openapi('ChangePassword');

const client = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent') });
const setCookie = (res: Response, token: string) => res.cookie(REFRESH_COOKIE, token, cookieOptions);

export const authRouter = new ApiRouter('/auth', 'Autenticación')
  .post('/login', { summary: 'Iniciar sesión', role: 'public', body: LoginBody, response: TokenResponse }, async ({ req, res, body }) => {
    const result = await service.login(body.email, body.password, body.companyId, client(req));
    req.auth = { userId: result.user.id, apiKeyId: null, role: result.role, companyId: result.company?.id ?? null, branchIds: result.branchIds, isSuperAdmin: result.user.isSuperAdmin, via: 'jwt' };
    await audit(req, { action: 'LOGIN', entity: 'User', entityId: result.user.id });
    setCookie(res, result.refreshToken);
    return result;
  })
  .post(
    '/refresh',
    { summary: 'Renovar tokens (rotación de refresh token)', role: 'public', body: RefreshBody, response: TokenResponse },
    async ({ req, res, body }) => {
      const token = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
      if (!token) throw Unauthorized('Refresh token requerido');
      const result = await service.refresh(token, client(req));
      setCookie(res, result.refreshToken);
      return result;
    },
  )
  .post('/logout', { summary: 'Cerrar sesión (revoca el refresh token)', role: 'public', body: RefreshBody }, async ({ req, res, body }) => {
    await service.logout(body.refreshToken ?? req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  })
  .post(
    '/logout-all',
    { summary: 'Cerrar todas las sesiones del usuario', role: 'VIEWER', middlewares: [requireUser] },
    async ({ req, res }) => {
      await service.logoutAll(req.auth!.userId!);
      res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
    },
  )
  .get(
    '/me',
    { summary: 'Perfil de la sesión', description: 'Usuario, empresa activa, rol, sucursales y empresas disponibles.', role: 'VIEWER', response: SessionProfile, middlewares: [requireUser] },
    ({ req }) => service.sessionProfile(req.auth!.userId!, req.auth!.companyId),
  )
  .post(
    '/switch-company',
    {
      summary: 'Cambiar de empresa activa',
      description: 'Emite nuevos tokens para operar con otra empresa a la que el usuario tenga acceso.',
      role: 'VIEWER',
      body: z.object({ companyId: z.string().uuid(), refreshToken: z.string().optional() }),
      response: TokenResponse,
      middlewares: [requireUser],
    },
    async ({ req, res, body }) => {
      const result = await service.switchCompany(req.auth!.userId!, body.companyId, body.refreshToken ?? req.cookies?.[REFRESH_COOKIE], client(req));
      req.auth = { ...req.auth!, companyId: result.company?.id ?? null };
      await audit(req, { action: 'SWITCH_COMPANY', entity: 'Company', entityId: body.companyId });
      setCookie(res, result.refreshToken);
      return result;
    },
  )
  .patch(
    '/me/password',
    { summary: 'Cambiar contraseña propia', description: 'Cierra todas las sesiones activas.', role: 'VIEWER', body: ChangePasswordBody, middlewares: [requireUser] },
    async ({ req, body }) => {
      await service.changePassword(req.auth!.userId!, body.currentPassword, body.newPassword);
      await audit(req, { action: 'CHANGE_PASSWORD', entity: 'User', entityId: req.auth!.userId });
    },
  );
