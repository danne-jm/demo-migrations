import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext } from 'react';
import defaultLogger, { logInfo } from '../utils/logger';
const LoggingContext = createContext({ defaultLogger, logInfo });
export const LoggingProvider = ({ children }) => (_jsx(LoggingContext.Provider, { value: { defaultLogger, logInfo }, children: children }));
export const useLoggingContext = () => useContext(LoggingContext);
