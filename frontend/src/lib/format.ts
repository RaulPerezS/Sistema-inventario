const currency = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 });
const number = new Intl.NumberFormat('es-PE');
const dateTime = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' });

export const fmtMoney = (v: string | number | null | undefined) => currency.format(Number(v ?? 0));
export const fmtNumber = (v: number | string | null | undefined) => number.format(Number(v ?? 0));
export const fmtDateTime = (v: string | null | undefined) => (v ? dateTime.format(new Date(v)) : '—');
export const fmtDate = (v: string | null | undefined) => (v ? date.format(new Date(v)) : '—');

export const ROLE_LABELS = { ADMIN: 'Administrador', MANAGER: 'Gerente', OPERATOR: 'Operador', VIEWER: 'Consulta' } as const;

export const MOVEMENT_LABELS = {
  IN: 'Entrada',
  OUT: 'Salida',
  ADJUSTMENT: 'Ajuste',
  TRANSFER_IN: 'Transf. entrada',
  TRANSFER_OUT: 'Transf. salida',
  PURCHASE: 'Compra',
  SALE: 'Venta',
} as const;

export const PURCHASE_STATUS = {
  DRAFT: { label: 'Borrador', tone: 'gray' },
  ORDERED: { label: 'Emitida', tone: 'blue' },
  PARTIALLY_RECEIVED: { label: 'Recepción parcial', tone: 'amber' },
  RECEIVED: { label: 'Recibida', tone: 'green' },
  CANCELLED: { label: 'Cancelada', tone: 'red' },
} as const;

export const SALES_STATUS = {
  DRAFT: { label: 'Borrador', tone: 'gray' },
  CONFIRMED: { label: 'Confirmada', tone: 'blue' },
  FULFILLED: { label: 'Despachada', tone: 'green' },
  CANCELLED: { label: 'Cancelada', tone: 'red' },
} as const;
