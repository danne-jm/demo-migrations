export declare const useDeepLogger: () => {
    trackEvent: (event: string) => void;
    baseLogging: (message: string, ...args: any[]) => void;
};
