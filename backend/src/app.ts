import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import compress from 'koa-compress';
import cors from '@koa/cors';

import { env } from './config/env';
import { errorHandlerMiddleware } from './middleware/error-handler';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { requestLoggerMiddleware } from './middleware/request-logger';
import { securityHeadersMiddleware } from './middleware/security-headers';
import { router } from './routes';

export const createApp = (): Koa => {
  const app = new Koa();

  app.proxy = env.trustProxy;

  app.use(errorHandlerMiddleware());
  app.use(requestLoggerMiddleware());
  app.use(securityHeadersMiddleware());

  app.use(
    cors({
      credentials: env.corsAllowCredentials,
      maxAge: env.corsMaxAge,
      origin: (ctx) => {
        const requestOrigin = ctx.request.header.origin;
        if (!requestOrigin) {
          return '*';
        }

        return env.corsAllowOrigins.includes(requestOrigin) ? requestOrigin : (env.corsAllowOrigins[0] ?? '*');
      }
    })
  );

  app.use(
    bodyParser({
      enableTypes: ['json', 'form', 'text'],
      jsonLimit: env.bodyLimit,
      formLimit: env.bodyLimit,
      textLimit: env.bodyLimit
    })
  );

  app.use(compress());
  app.use(rateLimitMiddleware());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
};
