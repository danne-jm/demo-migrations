import React, { createContext, useContext, ReactNode } from 'react';
import defaultLogger, { logInfo } from '../utils/logger';

const LoggingContext = createContext({ defaultLogger, logInfo });

export const LoggingProvider = ({ children }: { children: ReactNode }) => (
  <LoggingContext.Provider value={{ defaultLogger, logInfo }}>
    {children}
  </LoggingContext.Provider>
);

export const useLoggingContext = () => useContext(LoggingContext);