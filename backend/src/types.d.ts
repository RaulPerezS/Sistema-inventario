import type { Role } from '@prisma/client';

export interface AuthContext {
  userId: string | null;
  apiKeyId: string | null;
  /** Rol efectivo en la empresa activa. */
  role: Role;
  /** Empresa activa (null solo para un super administrador sin empresa seleccionada). */
  companyId: string | null;
  /** Sucursales permitidas; null = todas las de la empresa. */
  branchIds: string[] | null;
  isSuperAdmin: boolean;
  email?: string;
  via: 'jwt' | 'api_key';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Caché por petición de los almacenes permitidos. */
      allowedWarehouses?: string[] | null;
    }
  }
}

export {};
