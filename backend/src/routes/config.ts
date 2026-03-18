import Router from '@koa/router';
import settings from '../../../configs/app.settings.json';

import { env } from '../config/env';

export const configRoutes = new Router({ prefix: '/config' });

configRoutes.get('/public', (ctx) => {
  ctx.status = 200;
  ctx.body = {
    app: {
      name: env.appName,
      env: env.appEnv,
      region: settings.application.region
    },
    frontend: {
      apiBaseUrl: settings.frontend.api.baseUrl,
      supportedLocales: settings.frontend.ui.supportedLocales,
      features: settings.frontend.features
    },
    backend: {
      corsOrigins: env.corsAllowOrigins,
      rateLimitMax: env.rateLimitMax,
      requestTimeoutMs: env.requestTimeoutMs
    },
    requestId: ctx.state.requestId
  };
});
