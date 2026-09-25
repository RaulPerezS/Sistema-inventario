import pino from 'pino';
import { env, isProd } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'],
  transport: isProd || env.LOG_LEVEL === 'silent' ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
