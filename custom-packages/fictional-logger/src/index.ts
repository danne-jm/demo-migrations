/**
 * Fictional Logger implementation
 * Exports a `logV2` function to be used across the monorepo.
 */
export const logV2 = (message: string, ...args: any[]): void => {
  const timestamp = new Date().toISOString();
  console.log(`[fictional-logger@2.1.0] V2 LOG ${timestamp} - ${message}`, ...args);
};
