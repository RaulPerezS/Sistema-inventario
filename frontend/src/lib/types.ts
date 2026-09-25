export type Role = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ref {
  id: string;
  name: string;
}

export interface Category extends Ref {
  description: string | null;
  parentId: string | null;
  parent: Ref | null;
  _count: { products: number; children: number };
}

export interface Party extends Ref {
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  contactName?: string | null;
}

export interface Warehouse extends Ref {
  code: string;
  address: string | null;
  isActive: boolean;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unit: string;
  categoryId: string | null;
  supplierId: string | null;
  category: Ref | null;
  supplier: Ref | null;
  costPrice: string;
  salePrice: string;
  minStock: number;
  maxStock: number | null;
  isActive: boolean;
  totalStock: number;
  isLowStock: boolean;
  stocks?: { quantity: number; warehouse: { id: string; code: string; name: string } }[];
}

export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'PURCHASE' | 'SALE';

export interface Movement {
  id: string;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  product: { id: string; sku: string; name: string; unit: string };
  warehouse: { id: string; code: string; name: string };
  user: Ref | null;
}

export interface StockLevel {
  productId: string;
  warehouseId: string;
  quantity: number;
  updatedAt: string;
  product: { id: string; sku: string; name: string; unit: string; minStock: number; costPrice: string };
  warehouse: { id: string; code: string; name: string };
}

export interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  receivedQuantity?: number;
  unitCost?: string;
  unitPrice?: string;
  product: { id: string; sku: string; name: string; unit: string };
}

export type PurchaseStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
export type SalesStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  number: string;
  status: PurchaseStatus;
  expectedDate: string | null;
  notes: string | null;
  total: string;
  supplier: Ref;
  warehouse: { id: string; code: string; name: string };
  createdBy: Ref | null;
  items: OrderItem[];
  createdAt: string;
}

export interface SalesOrder {
  id: string;
  number: string;
  status: SalesStatus;
  notes: string | null;
  total: string;
  customer: Ref | null;
  warehouse: { id: string; code: string; name: string };
  createdBy: Ref | null;
  items: OrderItem[];
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  role: Role;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string; email: string };
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  changes: unknown;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
  apiKey: Ref | null;
}
