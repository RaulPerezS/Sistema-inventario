import { z } from '../../docs/zod.js';
import { prisma } from '../../lib/prisma.js';
import { optionalText } from '../../lib/common-schemas.js';
import { partyFields, PartyOut, partyRouter } from '../_shared/party.js';

const SupplierBody = z.object({ ...partyFields, contactName: optionalText(120) }).openapi('SupplierInput');
const SupplierOut = z.object({ ...PartyOut, contactName: z.string().nullable() }).openapi('Supplier');

export const suppliersRouter = partyRouter({
  basePath: '/suppliers',
  tag: 'Proveedores',
  entity: 'Supplier',
  label: 'proveedor',
  delegate: prisma.supplier as never,
  body: SupplierBody,
  out: SupplierOut,
  references: async (id) => {
    const [products, orders] = await Promise.all([
      prisma.product.count({ where: { supplierId: id } }),
      prisma.purchaseOrder.count({ where: { supplierId: id } }),
    ]);
    return products + orders;
  },
});
