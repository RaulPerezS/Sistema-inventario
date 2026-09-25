import { z } from '../../docs/zod.js';
import { optionalText, Timestamps } from '../../lib/common-schemas.js';
import { isValidRut, normalizeRut } from '../../lib/rut.js';

export const Rut = z
  .string()
  .trim()
  .refine(isValidRut, 'RUT inválido (verifique el dígito verificador)')
  .transform(normalizeRut)
  .openapi({ type: 'string', example: '76.123.456-0' });

export const CompanyFields = {
  rut: Rut,
  name: z.string().trim().min(2).max(200).openapi({ description: 'Razón social' }),
  tradeName: optionalText(200).openapi({ type: 'string', description: 'Nombre de fantasía' }),
  giro: optionalText(200).openapi({ type: 'string' }),
  address: optionalText(300).openapi({ type: 'string' }),
  city: optionalText(100).openapi({ type: 'string' }),
  phone: optionalText(40).openapi({ type: 'string' }),
  email: z.string().trim().email().nullish().or(z.literal('').transform(() => null)),
  taxRate: z.coerce.number().min(0).max(100).default(19).openapi({ description: 'Tasa de IVA (%)' }),
};

export const CompanyOut = z
  .object({
    id: z.string().uuid(),
    rut: z.string(),
    name: z.string(),
    tradeName: z.string().nullable(),
    giro: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    taxRate: z.string(),
    isActive: z.boolean(),
    _count: z.object({ branches: z.number(), memberships: z.number(), warehouses: z.number() }).optional(),
    ...Timestamps,
  })
  .openapi('Company');
