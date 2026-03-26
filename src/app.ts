import 'dotenv/config';
import './instrumentation.js';
import { createApp } from './create-app.js';
import { shutdownLangfuseOtel } from './instrumentation.js';
import { logger } from './shared/logger.js';

const app = createApp();
const port = Number(process.env.PORT ?? '3000');
const server = app.listen(port, () => {
  logger.info({ port }, 'listening');
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown');
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await shutdownLangfuseOtel().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
