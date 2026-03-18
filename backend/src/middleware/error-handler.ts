import { Context, Next } from 'koa';

export const errorHandlerMiddleware = () => async (ctx: Context, next: Next): Promise<void> => {
  try {
    await next();

    if (ctx.status === 404 && !ctx.body) {
      ctx.status = 404;
      ctx.body = {
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found'
        },
        requestId: ctx.state.requestId
      };
    }
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = status >= 500 ? 'Internal server error' : (error as Error).message;

    ctx.status = status;
    ctx.body = {
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message
      },
      requestId: ctx.state.requestId
    };

    if (status >= 500) {
      console.error('Unhandled error', {
        error,
        method: ctx.method,
        path: ctx.path,
        requestId: ctx.state.requestId
      });
    }
  }
};
