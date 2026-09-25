export type Role = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface CompanyRef {
  id: string;
  name: string;
  tradeName: string | null;
  rut: string;
}

/** Perfil de la sesión: usuario + empresa activa + permisos en ella. */
export interface Session {
  user: SessionUser;
  company: (CompanyRef & { giro: string | null; taxRate: string }) | null;
  role: Role;
  /** null = todas las sucursales */
  branchIds: string[] | null;
  branches: { id: string; code: string; name: string }[];
  companies: (CompanyRef & { role: Role })[];
}

/** Usuario visto desde la empresa activa. */
export interface CompanyUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchIds: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Company extends CompanyRef {
  giro: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  taxRate: string;
  isActive: boolean;
  createdAt: string;
  _count?: { branches: number; memberships: number; warehouses: number };
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  isActive: boolean;
  _count: { warehouses: number };
}

type BranchRef = { id: string; code: string; name: string };

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
  branchId: string;
  branch: BranchRef;
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
  taxExempt: boolean;
  isActive: boolean;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  isLowStock: boolean;
  stocks?: { quantity: number; reserved: number; warehouse: { id: string; code: string; name: string; branch: BranchRef } }[];
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
  reserved: number;
  available: number;
  updatedAt: string;
  product: { id: string; sku: string; name: string; unit: string; minStock: number; costPrice: string };
  warehouse: { id: string; code: string; name: string; branch: BranchRef };
}

export interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  receivedQuantity?: number;
  unitCost?: string;
  unitPrice?: string;
  taxRate: string;
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
  subtotal: string;
  tax: string;
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
  subtotal: string;
  tax: string;
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
  branchIds: string[];
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

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  stats: { pending: number; success: number; failed: number };
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  payload: unknown;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}
