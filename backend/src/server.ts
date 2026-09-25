import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startWebhookWorker, stopWebhookWorker } from './lib/webhooks.js';

const app = createApp();
if (env.WEBHOOKS_ENABLED) startWebhookWorker();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 API escuchando en http://localhost:${env.PORT} — docs en http://localhost:${env.PORT}/api/docs`);
});

// Apagado ordenado: deja de aceptar conexiones y cierra la base de datos
const shutdown = (signal: string) => {
  logger.info(`${signal} recibido, cerrando servidor...`);
  stopWebhookWorker();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
