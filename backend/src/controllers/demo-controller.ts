import { defaultLoggerService, LoggerService } from '../services/logger-service';

export const handleDemoAction = async (ctx: any) => {
  const localLogger = new LoggerService('Controller');
  
  defaultLoggerService.performLog('Accessing demo path');
  localLogger.performLog('Inside handleDemoAction controller method');
  
  ctx.body = { status: 'logged via obscure path through services and objects' };
};