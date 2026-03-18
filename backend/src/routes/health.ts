import Router from '@koa/router';

import { env } from '../config/env';

export const healthRoutes = new Router({ prefix: '/health' });

healthRoutes.get('/', (ctx) => {
  ctx.status = 200;
  ctx.body = {
    service: env.appName,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    requestId: ctx.state.requestId
  };
});
