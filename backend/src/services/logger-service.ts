import { logging as baseLogging } from 'fictional-logger';

export class LoggerService {
  constructor(private context: string) {}

  public performLog(message: string) {
    baseLogging(`[Backend - ${this.context}] ${message}`);
  }
}

export const defaultLoggerService = new LoggerService('Global');