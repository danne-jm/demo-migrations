import { Context, Next } from 'koa';

import { env } from '../config/env';

const shouldLogBody = process.env.ENABLE_REQUEST_LOG_BODY === 'true';

export const requestLoggerMiddleware = () => async (ctx: Context, next: Next): Promise<void> => {
  const startedAt = Date.now();

  await next();

  const latencyMs = Date.now() - startedAt;
  const baseLog = {
    requestId: ctx.state.requestId,
    method: ctx.method,
    path: ctx.path,
    status: ctx.status,
    latencyMs
  };

  if (env.logLevel === 'debug' && shouldLogBody && ctx.request.body) {
    console.log({ ...baseLog, body: ctx.request.body });
    return;
  }

  console.log(baseLog);
};
