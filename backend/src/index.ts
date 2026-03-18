import { createApp } from './app';
import { env } from './config/env';

const app = createApp();
const server = app.listen(env.port, env.host, () => {
  console.log(`[${env.appName}] listening on http://${env.host}:${env.port} (${env.appEnv})`);
});

const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`Received ${signal}. Starting graceful shutdown...`);
  server.close((error) => {
    if (error) {
      console.error('Failed to shut down cleanly', error);
      process.exit(1);
    }

    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
