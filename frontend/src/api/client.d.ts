export type HealthResponse = {
    service: string;
    status: string;
    timestamp: string;
    uptimeSeconds: number;
    requestId: string;
};
export type PublicConfigResponse = {
    app: {
        name: string;
        env: string;
        region: string;
    };
    frontend: {
        apiBaseUrl: string;
        supportedLocales: string[];
        features: Record<string, boolean>;
    };
    backend: {
        corsOrigins: string[];
        rateLimitMax: number;
        requestTimeoutMs: number;
    };
    requestId: string;
};
export declare const getHealth: () => Promise<HealthResponse>;
export declare const getPublicConfig: () => Promise<PublicConfigResponse>;
