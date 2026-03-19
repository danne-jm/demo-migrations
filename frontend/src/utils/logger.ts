import { logging as obscureLogger } from 'fictional-logger';

// Re-exporting as a named function and as default
export const logInfo = (msg: string) => obscureLogger(`[Frontend Info] ${msg}`);
export default obscureLogger;