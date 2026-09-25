import { z } from '../../docs/zod.js';
import { DateFrom, DateTo, Money, optionalText } from '../../lib/common-schemas.js';
import { PaginationQuery, QueryBool } from '../../lib/pagination.js';

export const MovementTypeEnum = z
  .enum(['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'PURCHASE', 'SALE'])
  .openapi('MovementType');

const Qty = z.coerce.number().int('Debe ser un número entero').positive('Debe ser mayor a cero').max(1_000_000);

const common = { reference: optionalText(100), note: optionalText(500) };

export const EntryBody = z
  .object({
    warehouseId: z.string().uuid(),
    items: z.array(z.object({ productId: z.string().uuid(), quantity: Qty, unitCost: Money.optional() })).min(1).max(500),
    ...common,
  })
  .openapi('StockEntry');

export const ExitBody = z
  .object({
    warehouseId: z.string().uuid(),
    items: z.array(z.object({ productId: z.string().uuid(), quantity: Qty })).min(1).max(500),
    ...common,
  })
  .openapi('StockExit');

export const AdjustmentBody = z
  .object({
    warehouseId: z.string().uuid(),
    items: z
      .array(z.object({ productId: z.string().uuid(), countedQuantity: z.coerce.number().int().min(0).max(10_000_000) }))
      .min(1)
      .max(500),
    ...common,
  })
  .openapi('StockAdjustment', { description: 'Ajuste por conteo físico: se indica la cantidad contada y el sistema calcula la diferencia.' });

export const TransferBody = z
  .object({
    fromWarehouseId: z.string().uuid(),
    toWarehouseId: z.string().uuid(),
    items: z.array(z.object({ productId: z.string().uuid(), quantity: Qty })).min(1).max(500),
    ...common,
  })
  .refine((b) => b.fromWarehouseId !== b.toWarehouseId, { message: 'Los almacenes de origen y destino deben ser distintos', path: ['toWarehouseId'] })
  .openapi('StockTransfer');

export const MovementOut = z
  .object({
    id: z.string().uuid(),
    type: MovementTypeEnum,
    quantity: z.number().int(),
    balanceAfter: z.number().int(),
    unitCost: z.string().nullable(),
    reference: z.string().nullable(),
    note: z.string().nullable(),
    transferId: z.string().uuid().nullable(),
    purchaseOrderId: z.string().uuid().nullable(),
    salesOrderId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    product: z.object({ id: z.string(), sku: z.string(), name: z.string(), unit: z.string() }),
    warehouse: z.object({ id: z.string(), code: z.string(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string() }).nullable(),
  })
  .openapi('StockMovement');

export const MovementsQuery = PaginationQuery.extend({
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  type: MovementTypeEnum.optional(),
  from: DateFrom.optional(),
  to: DateTo.optional(),
});

export const StockQuery = PaginationQuery.extend({
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  onlyAvailable: QueryBool.optional().openapi({ description: 'Solo registros con cantidad > 0' }),
});

export const StockOut = z
  .object({
    productId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    quantity: z.number().int(),
    updatedAt: z.string().datetime(),
    product: z.object({ id: z.string(), sku: z.string(), name: z.string(), unit: z.string(), minStock: z.number(), costPrice: z.string() }),
    warehouse: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  })
  .openapi('StockLevel');
