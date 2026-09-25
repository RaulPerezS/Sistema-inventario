import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { apiRouter } from './routes.js';
import { generateOpenApiDocument } from './docs/registry.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('query parser', 'extended');

  // Identificador de petición para trazabilidad (se devuelve en `X-Request-Id`)
  app.use((req, res, next) => {
    req.id = req.header('x-request-id') ?? randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  if (!isTest) {
    app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id ?? randomUUID(), autoLogging: { ignore: (req) => req.url === '/api/v1/health' } }));
  }

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true, exposedHeaders: ['X-Request-Id', 'Content-Disposition'] }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const limiter = (max: number) =>
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Demasiadas peticiones, intente más tarde' } },
    });
  app.use('/api/v1/auth/login', limiter(env.AUTH_RATE_LIMIT_MAX));
  app.use('/api/v1/auth/refresh', limiter(env.AUTH_RATE_LIMIT_MAX * 5));
  app.use('/api', limiter(env.RATE_LIMIT_MAX));

  // Documentación OpenAPI
  const openapi = generateOpenApiDocument();
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Inventario API — Docs', swaggerOptions: { persistAuthorization: true } }));

  app.use('/api/v1', apiRouter);
  app.get('/', (_req, res) => res.json({ name: 'Sistema de Inventario API', version: '1.0.0', docs: '/api/docs', openapi: '/api/openapi.json' }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
