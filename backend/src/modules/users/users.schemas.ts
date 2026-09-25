import { z } from '../../docs/zod.js';
import { PaginationQuery, QueryBool } from '../../lib/pagination.js';

export const RoleEnum = z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']).openapi('Role');

export const Password = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128)
  .regex(/[A-Za-z]/, 'Debe contener letras')
  .regex(/\d/, 'Debe contener números');

/** Usuario visto desde una empresa: datos personales + su membresía en ella. */
export const CompanyUserOut = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: RoleEnum,
    branchIds: z.array(z.string().uuid()).openapi({ description: 'Sucursales permitidas; vacío = todas' }),
    isActive: z.boolean().openapi({ description: 'Acceso activo a esta empresa' }),
    lastLoginAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('CompanyUser');

export const CreateUserBody = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(2).max(120),
    password: Password.optional().openapi({ description: 'Obligatoria si el usuario no existe todavía en la plataforma' }),
    role: RoleEnum.default('VIEWER'),
    branchIds: z.array(z.string().uuid()).default([]),
    isActive: z.boolean().default(true),
  })
  .openapi('CreateCompanyUser', {
    description: 'Si el correo ya existe en la plataforma (p. ej. trabaja en otra empresa), se le da acceso a esta empresa sin cambiar su contraseña.',
  });

export const UpdateUserBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    password: Password,
    role: RoleEnum,
    branchIds: z.array(z.string().uuid()),
    isActive: z.boolean(),
  })
  .partial()
  .openapi('UpdateCompanyUser');

export const ListUsersQuery = PaginationQuery.extend({
  role: RoleEnum.optional(),
  isActive: QueryBool.optional(),
});

export const userSelect = {
  id: true,
  email: true,
  name: true,
  isSuperAdmin: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
