import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import type { ZodTypeAny, z } from 'zod';
import { registry, ErrorResponse } from '../docs/registry.js';
import { authenticate, authorize, requireSuperAdmin } from '../middleware/auth.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteSpec<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny> {
  summary: string;
  description?: string;
  /** Rol mínimo requerido en la empresa activa. `public` = sin autenticación; `superadmin` = administrador de plataforma. */
  role: Role | 'public' | 'superadmin';
  params?: P;
  query?: Q;
  body?: B;
  response?: ZodTypeAny;
  /** Código de éxito (200 por defecto). */
  status?: number;
  /** Tipo de contenido alternativo de la respuesta (p. ej. text/csv). */
  produces?: string;
  middlewares?: RequestHandler[];
}

export interface HandlerContext<P, Q, B> {
  req: Request;
  res: Response;
  params: P;
  query: Q;
  body: B;
}


type Out<T> = T extends ZodTypeAny ? z.infer<T> : Record<string, never>;

/**
 * Router que combina en una sola declaración:
 * autenticación + autorización por rol + validación con Zod + documentación OpenAPI.
 */
export class ApiRouter {
  readonly router = Router();

  constructor(
    private readonly basePath: string,
    private readonly tag: string,
  ) {}

  private add<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny>(
    method: Method,
    path: string,
    spec: RouteSpec<P, Q, B>,
    handler: (ctx: HandlerContext<Out<P>, Out<Q>, Out<B>>) => unknown | Promise<unknown>,
  ) {
    this.document(method, path, spec);

    const guards: RequestHandler[] =
      spec.role === 'public'
        ? []
        : spec.role === 'superadmin'
          ? [authenticate as RequestHandler, requireSuperAdmin as RequestHandler]
          : [authenticate as RequestHandler, authorize(spec.role) as RequestHandler];

    this.router[method](path, ...guards, ...(spec.middlewares ?? []), async (req: Request, res: Response) => {
      const params = (spec.params ? spec.params.parse(req.params) : {}) as Out<P>;
      const query = (spec.query ? spec.query.parse(req.query) : {}) as Out<Q>;
      const body = (spec.body ? spec.body.parse(req.body ?? {}) : {}) as Out<B>;
      const result = await handler({ req, res, params, query, body });
      if (res.headersSent) return;
      if (result === undefined) {
        res.status(spec.status ?? 204).end();
        return;
      }
      res.status(spec.status ?? 200).json(result);
    });
    return this;
  }

  private document(method: Method, path: string, spec: RouteSpec<ZodTypeAny, ZodTypeAny, ZodTypeAny>) {
    const fullPath = (this.basePath + path).replace(/\/$/, '').replace(/:(\w+)/g, '{$1}') || '/';
    const status = spec.status ?? (spec.response || spec.produces ? 200 : 204);
    const errors = {
      400: { description: 'Datos inválidos', content: { 'application/json': { schema: ErrorResponse } } },
      ...(spec.role !== 'public' && {
        401: { description: 'No autenticado', content: { 'application/json': { schema: ErrorResponse } } },
        403: { description: 'Sin permisos', content: { 'application/json': { schema: ErrorResponse } } },
      }),
    };

    registry.registerPath({
      method,
      path: fullPath,
      tags: [this.tag],
      summary: spec.summary,
      description: [
        spec.description,
        spec.role === 'public' ? '**Público**' : spec.role === 'superadmin' ? '**Solo administrador de plataforma**' : `**Rol mínimo:** \`${spec.role}\``,
      ]
        .filter(Boolean)
        .join('\n\n'),
      security: spec.role === 'public' ? [] : undefined,
      request: {
        params: spec.params as never,
        query: spec.query as never,
        body: spec.body ? { content: { 'application/json': { schema: spec.body } } } : undefined,
      },
      responses: {
        [status]: spec.produces
          ? { description: 'OK', content: { [spec.produces]: { schema: { type: 'string' } } } }
          : spec.response
            ? { description: 'OK', content: { 'application/json': { schema: spec.response } } }
            : { description: 'Sin contenido' },
        ...errors,
      },
    });
  }

  get<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny>(
    path: string,
    spec: RouteSpec<P, Q, B>,
    handler: (ctx: HandlerContext<Out<P>, Out<Q>, Out<B>>) => unknown,
  ) {
    return this.add('get', path, spec, handler);
  }
  post<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny>(
    path: string,
    spec: RouteSpec<P, Q, B>,
    handler: (ctx: HandlerContext<Out<P>, Out<Q>, Out<B>>) => unknown,
  ) {
    return this.add('post', path, spec, handler);
  }
  put<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny>(
    path: string,
    spec: RouteSpec<P, Q, B>,
    handler: (ctx: HandlerContext<Out<P>, Out<Q>, Out<B>>) => unknown,
  ) {
    return this.add('put', path, spec, handler);
  }
  patch<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny>(
    path: string,
    spec: RouteSpec<P, Q, B>,
    handler: (ctx: HandlerContext<Out<P>, Out<Q>, Out<B>>) => unknown,
  ) {
    return this.add('patch', path, spec, handler);
  }
  delete<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny>(
    path: string,
    spec: RouteSpec<P, Q, B>,
    handler: (ctx: HandlerContext<Out<P>, Out<Q>, Out<B>>) => unknown,
  ) {
    return this.add('delete', path, spec, handler);
  }
}
