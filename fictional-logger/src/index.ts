/**
 * Fictional Logger implementation
 * Exports a `logging` function to be used across the monorepo.
 */
export const logging = (message: string, ...args: any[]): void => {
  const timestamp = new Date().toISOString();
  console.log(`[fictional-logger@1.0.0] ${timestamp} - ${message}`, ...args);
};
