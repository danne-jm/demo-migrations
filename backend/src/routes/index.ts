import Router from '@koa/router';

import { configRoutes } from './config';
import { healthRoutes } from './health';

export const router = new Router({ prefix: '/api/v1' });

router.use(healthRoutes.routes(), healthRoutes.allowedMethods());
router.use(configRoutes.routes(), configRoutes.allowedMethods());

router.get('/', (ctx) => {
  ctx.status = 200;
  ctx.body = {
    message: 'Koa API is running',
    version: 'v1',
    requestId: ctx.state.requestId
  };
});
