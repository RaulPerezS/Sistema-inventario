import { z } from '../../docs/zod.js';
import { prisma } from '../../lib/prisma.js';
import { partyFields, PartyOut, partyRouter } from '../_shared/party.js';

const CustomerBody = z.object(partyFields).openapi('CustomerInput');
const CustomerOut = z.object(PartyOut).openapi('Customer');

export const customersRouter = partyRouter({
  basePath: '/customers',
  tag: 'Clientes',
  entity: 'Customer',
  label: 'cliente',
  delegate: prisma.customer as never,
  body: CustomerBody,
  out: CustomerOut,
  references: (id) => prisma.salesOrder.count({ where: { customerId: id } }),
});
