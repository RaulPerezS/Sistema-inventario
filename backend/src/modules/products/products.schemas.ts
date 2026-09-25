import { z } from '../../docs/zod.js';
import { DecimalOut, Money, optionalText, Timestamps } from '../../lib/common-schemas.js';
import { PaginationQuery, QueryBool } from '../../lib/pagination.js';

export const ProductOut = z
  .object({
    id: z.string().uuid(),
    sku: z.string(),
    barcode: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    unit: z.string(),
    categoryId: z.string().uuid().nullable(),
    supplierId: z.string().uuid().nullable(),
    category: z.object({ id: z.string(), name: z.string() }).nullable(),
    supplier: z.object({ id: z.string(), name: z.string() }).nullable(),
    costPrice: DecimalOut,
    salePrice: DecimalOut,
    minStock: z.number().int(),
    maxStock: z.number().int().nullable(),
    isActive: z.boolean(),
    totalStock: z.number().int().openapi({ description: 'Suma de existencias en todos los almacenes' }),
    isLowStock: z.boolean(),
    ...Timestamps,
  })
  .openapi('Product');

export const ProductDetailOut = ProductOut.extend({
  stocks: z.array(z.object({ quantity: z.number(), warehouse: z.object({ id: z.string(), code: z.string(), name: z.string() }) })),
}).openapi('ProductDetail');

const base = {
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo')
    .openapi({ example: 'LAP-001' }),
  barcode: optionalText(64),
  name: z.string().trim().min(2).max(200),
  description: optionalText(2000),
  unit: z.string().trim().toUpperCase().min(1).max(10).default('UND').openapi({ example: 'UND' }),
  categoryId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  costPrice: Money.default(0),
  salePrice: Money.default(0),
  minStock: z.coerce.number().int().min(0).default(0),
  maxStock: z.coerce.number().int().min(0).nullish(),
  isActive: z.boolean().default(true),
};

const maxGteMin = (p: { minStock?: number; maxStock?: number | null }) => p.maxStock == null || p.minStock == null || p.maxStock >= p.minStock;

export const CreateProductBody = z
  .object({
    ...base,
    initialStock: z
      .object({ warehouseId: z.string().uuid(), quantity: z.coerce.number().int().positive() })
      .optional()
      .openapi({ description: 'Stock inicial opcional (genera un movimiento de entrada)' }),
  })
  .refine(maxGteMin, { message: 'El stock máximo debe ser mayor o igual al mínimo', path: ['maxStock'] })
  .openapi('CreateProduct');

export const UpdateProductBody = z
  .object(base)
  .partial()
  .refine(maxGteMin, { message: 'El stock máximo debe ser mayor o igual al mínimo', path: ['maxStock'] })
  .openapi('UpdateProduct');

export const ImportProductsBody = z
  .object({ products: z.array(z.object(base)).min(1).max(1000) })
  .openapi('ImportProducts', { description: 'Alta/actualización masiva por SKU (upsert).' });

export const ListProductsQuery = PaginationQuery.extend({
  categoryId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  isActive: QueryBool.optional(),
  lowStock: QueryBool.optional().openapi({ description: 'Solo productos con stock total ≤ stock mínimo' }),
});
