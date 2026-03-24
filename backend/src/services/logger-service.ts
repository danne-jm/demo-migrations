import { logV2 as baseLogging } from '@danieljaurellmevorach/fictional-logger';

export class LoggerService {
  constructor(private context: string) {}

  public performLog(message: string) {
    baseLogging(`[Backend - ${this.context}] ${message}`);
  }
}

export const defaultLoggerService = new LoggerService('Global');
