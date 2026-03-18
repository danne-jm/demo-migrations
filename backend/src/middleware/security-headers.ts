import helmet from 'koa-helmet';
import { Context, Next } from 'koa';

import { env } from '../config/env';

export const securityHeadersMiddleware = () => {
  if (!env.helmetEnabled) {
    return async (_ctx: Context, next: Next): Promise<void> => {
      await next();
    };
  }

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", ...env.corsAllowOrigins],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });
};
