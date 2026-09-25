import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessPayload {
  sub: string;
  email: string;
  /** Empresa activa de la sesión. */
  companyId: string | null;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    issuer: 'inventario-api',
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'inventario-api' }) as AccessPayload;
}
