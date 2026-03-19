import { useLoggingContext } from '../context/LoggingContext';

export const useDeepLogger = () => {
  const { logInfo, defaultLogger } = useLoggingContext();
  
  // Wrap the context logger in a hook return
  return {
    trackEvent: (event: string) => logInfo(`Tracked Event: ${event}`),
    baseLogging: defaultLogger
  };
};