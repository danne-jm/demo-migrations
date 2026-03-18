import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

type AppEnv = {
  appName: string;
  appEnv: string;
  host: string;
  port: number;
  logLevel: string;
  requestTimeoutMs: number;
  trustProxy: boolean;
  bodyLimit: string;
  corsAllowOrigins: string[];
  corsAllowCredentials: boolean;
  corsMaxAge: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  helmetEnabled: boolean;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value || !value.trim()) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const env: AppEnv = {
  appName: process.env.APP_NAME ?? 'demo-fullstack-app',
  appEnv: process.env.APP_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: parseNumber(process.env.PORT, 4000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 10000),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  bodyLimit: process.env.BODY_LIMIT ?? '2mb',
  corsAllowOrigins: parseList(process.env.CORS_ALLOW_ORIGINS, ['http://localhost:5173']),
  corsAllowCredentials: parseBoolean(process.env.CORS_ALLOW_CREDENTIALS, true),
  corsMaxAge: parseNumber(process.env.CORS_MAX_AGE, 86400),
  rateLimitWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMax: parseNumber(process.env.RATE_LIMIT_MAX, 120),
  helmetEnabled: parseBoolean(process.env.HELMET_ENABLED, true)
};
