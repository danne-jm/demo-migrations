import axios from 'axios';

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

const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 10000
});

export const getHealth = async (): Promise<HealthResponse> => {
  const { data } = await apiClient.get<HealthResponse>('/health');
  return data;
};

export const getPublicConfig = async (): Promise<PublicConfigResponse> => {
  const { data } = await apiClient.get<PublicConfigResponse>('/config/public');
  return data;
};
