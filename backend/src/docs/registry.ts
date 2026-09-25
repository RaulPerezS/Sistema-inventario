import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from './zod.js';

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Token de acceso obtenido en `POST /auth/login`',
});
registry.registerComponent('securitySchemes', 'apiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  description: 'Clave para integraciones de sistemas externos (se crea en `POST /api-keys`)',
});

export const ErrorResponse = registry.register(
  'Error',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string(),
      details: z.any().optional(),
      requestId: z.string().optional(),
    }),
  }),
);

export const PaginationMeta = z
  .object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() })
  .openapi('PaginationMeta');

export const paginatedOf = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item), meta: PaginationMeta });

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Sistema de Inventario — API',
      version: '1.0.0',
      description: [
        'API REST para la gestión integral de inventario: catálogo, almacenes, stock, movimientos,',
        'órdenes de compra y venta, reportes y auditoría.',
        '',
        '**Autenticación**: `Authorization: Bearer <token>` (usuarios) o `X-API-Key: <clave>` (integraciones).',
        '',
        '**Roles** (jerárquicos): `VIEWER` < `OPERATOR` < `MANAGER` < `ADMIN`.',
        '',
        '**Errores**: todas las respuestas de error siguen el formato `{ error: { code, message, details, requestId } }`.',
      ].join('\n'),
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }, { apiKey: [] }],
  });
}
