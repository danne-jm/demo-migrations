import { logging as obscureLogger } from '@danieljaurellmevorach/fictional-logger';
import log from 'loglevel';

// Set log level to info so it outputs to the console
log.setLevel('info');

// Re-exporting as a named function and as default
export const logInfo = (msg: string) => obscureLogger(`[Frontend Info] ${msg}`);
export default log.info;