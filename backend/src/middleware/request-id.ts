import { Context, Next } from 'koa';
import { randomUUID } from 'crypto';

export const requestIdMiddleware = () => async (ctx: Context, next: Next): Promise<void> => {
  const requestId = ctx.get('x-request-id') || randomUUID();
  ctx.state.requestId = requestId;
  ctx.set('x-request-id', requestId);
  await next();
};
