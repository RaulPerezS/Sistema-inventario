import { z } from '../../docs/zod.js';
import { PaginationQuery, QueryBool } from '../../lib/pagination.js';
import { Timestamps } from '../../lib/common-schemas.js';

export const RoleEnum = z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']).openapi('Role');

export const Password = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128)
  .regex(/[A-Za-z]/, 'Debe contener letras')
  .regex(/\d/, 'Debe contener números');

export const UserOut = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: RoleEnum,
    isActive: z.boolean(),
    lastLoginAt: z.string().datetime().nullable(),
    ...Timestamps,
  })
  .openapi('User');

export const CreateUserBody = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(2).max(120),
    password: Password,
    role: RoleEnum.default('VIEWER'),
    isActive: z.boolean().default(true),
  })
  .openapi('CreateUser');

export const UpdateUserBody = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(2).max(120),
    password: Password,
    role: RoleEnum,
    isActive: z.boolean(),
  })
  .partial()
  .openapi('UpdateUser');

export const ListUsersQuery = PaginationQuery.extend({
  role: RoleEnum.optional(),
  isActive: QueryBool.optional(),
});

export const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
