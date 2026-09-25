import type { Role } from '@prisma/client';

export interface AuthContext {
  userId: string | null;
  apiKeyId: string | null;
  role: Role;
  email?: string;
  via: 'jwt' | 'api_key';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
