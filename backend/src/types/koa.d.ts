import 'koa';

declare module 'koa' {
  interface DefaultState {
    requestId: string;
  }
}
