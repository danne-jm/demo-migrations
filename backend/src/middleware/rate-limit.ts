import { Context, Next } from 'koa';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { env } from '../config/env';

const limiter = new RateLimiterMemory({
  points: env.rateLimitMax,
  duration: Math.max(1, Math.floor(env.rateLimitWindowMs / 1000))
});

export const rateLimitMiddleware = () => {
  if (env.rateLimitMax <= 0) {
    return async (_ctx: Context, next: Next): Promise<void> => {
      await next();
    };
  }

  return async (ctx: Context, next: Next): Promise<void> => {
    const key = ctx.ip || 'unknown';

    try {
      const result = await limiter.consume(key, 1);

      ctx.set('Rate-Limit-Total', String(env.rateLimitMax));
      ctx.set('Rate-Limit-Remaining', String(Math.max(0, result.remainingPoints)));
      ctx.set('Rate-Limit-Reset', String(Math.max(0, Math.ceil(result.msBeforeNext / 1000))));

      await next();
    } catch {
      ctx.set('Rate-Limit-Total', String(env.rateLimitMax));
      ctx.set('Rate-Limit-Remaining', '0');
      ctx.status = 429;
      ctx.body = {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded'
        },
        requestId: ctx.state.requestId
      };
    }
  };
};
