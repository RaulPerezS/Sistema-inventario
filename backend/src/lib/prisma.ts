import { PrismaClient, Prisma } from '@prisma/client';
import { isProd } from '../config/env.js';

export const prisma = new PrismaClient({
  log: isProd ? ['error'] : ['error', 'warn'],
});

export type Tx = Prisma.TransactionClient;
export { Prisma };
