import { z } from '../docs/zod.js';

export const IdParams = z.object({ id: z.string().uuid().openapi({ description: 'Identificador (UUID)' }) });

export const Money = z.coerce
  .number()
  .nonnegative()
  .multipleOf(0.01, 'Máximo 2 decimales')
  .openapi({ type: 'number', example: 19.99 });

/** Decimal serializado como string por Prisma. */
export const DecimalOut = z.string().openapi({ example: '19.99' });

export const Timestamps = {
  createdAt: z.string().datetime().openapi({ type: 'string', format: 'date-time' }),
  updatedAt: z.string().datetime().openapi({ type: 'string', format: 'date-time' }),
};

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v));

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha "desde" (inclusive). Acepta `YYYY-MM-DD` o ISO-8601. */
export const DateFrom = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida')
  .transform((v) => new Date(v))
  .openapi({ type: 'string', format: 'date', example: '2026-01-01' });

/** Fecha "hasta" (inclusive). Si es `YYYY-MM-DD` incluye el día completo. */
export const DateTo = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida')
  .transform((v) => (DATE_ONLY.test(v) ? new Date(new Date(v).getTime() + 86_400_000 - 1) : new Date(v)))
  .openapi({ type: 'string', format: 'date', example: '2026-12-31' });
