import { ReactNode } from 'react';
export declare const LoggingProvider: ({ children }: {
    children: ReactNode;
}) => import("react/jsx-runtime").JSX.Element;
export declare const useLoggingContext: () => {
    defaultLogger: (message: string, ...args: any[]) => void;
    logInfo: (msg: string) => void;
};
