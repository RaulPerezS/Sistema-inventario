import { z } from '../docs/zod.js';

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1).openapi({ description: 'Número de página (desde 1)' }),
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ description: 'Elementos por página (máx. 100)' }),
  search: z.string().trim().optional().openapi({ description: 'Texto de búsqueda' }),
  sortBy: z.string().optional().openapi({ description: 'Campo de ordenamiento' }),
  sortOrder: z.enum(['asc', 'desc']).optional().openapi({ description: 'Dirección del ordenamiento' }),
});

export type PaginationInput = z.infer<typeof PaginationQuery>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function pageArgs({ page, limit }: { page: number; limit: number }) {
  return { skip: (page - 1) * limit, take: limit };
}

export function orderArgs<T extends string>(
  input: { sortBy?: string; sortOrder?: 'asc' | 'desc' },
  allowed: readonly T[],
  fallback: T,
): Record<string, 'asc' | 'desc'> {
  const field = allowed.includes(input.sortBy as T) ? (input.sortBy as T) : fallback;
  // Campos de texto ascendentes por defecto; fechas y cantidades descendentes
  const textual = ['name', 'code', 'sku', 'email', 'number'].includes(field);
  return { [field]: input.sortOrder ?? (textual ? 'asc' : 'desc') };
}

export function paginated<T>(data: T[], total: number, { page, limit }: { page: number; limit: number }): Paginated<T> {
  return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Boolean en query-string: "true"/"false"/"1"/"0". */
export const QueryBool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');
