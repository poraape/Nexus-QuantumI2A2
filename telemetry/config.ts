import { env } from '../utils/env';

type ThresholdConfig = {
  latencyMs: number;
  errorRate: number;
  throughputMin: number;
  consecutiveRetries: number;
};

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint: string;
  otlpHeaders?: string;
  alertWebhooks: {
    slack?: string;
    discord?: string;
  };
  thresholds: {
    llm: ThresholdConfig;
    ocr: ThresholdConfig;
    erp: ThresholdConfig;
  };
}

export const telemetryConfig: TelemetryConfig = {
  serviceName: env('VITE_TELEMETRY_SERVICE', 'nexus-quantum-backend'),
  serviceVersion: env('VITE_APP_VERSION', '1.0.0'),
  environment: env('VITE_APP_ENV', 'development'),
  otlpEndpoint: env('VITE_OTLP_ENDPOINT', 'http://localhost:4318'),
  otlpHeaders: env('VITE_OTLP_HEADERS', ''),
  alertWebhooks: {
    slack: env('VITE_SLACK_WEBHOOK'),
    discord: env('VITE_DISCORD_WEBHOOK'),
  },
  thresholds: {
    llm: {
      latencyMs: Number(env('VITE_LLM_LATENCY_THRESHOLD', '2000')),
      errorRate: Number(env('VITE_LLM_ERROR_THRESHOLD', '0.1')),
      throughputMin: Number(env('VITE_LLM_THROUGHPUT_MIN', '1')),
      consecutiveRetries: Number(env('VITE_LLM_RETRY_THRESHOLD', '3')),
    },
    ocr: {
      latencyMs: Number(env('VITE_OCR_LATENCY_THRESHOLD', '4000')),
      errorRate: Number(env('VITE_OCR_ERROR_THRESHOLD', '0.12')),
      throughputMin: Number(env('VITE_OCR_THROUGHPUT_MIN', '1')),
      consecutiveRetries: Number(env('VITE_OCR_RETRY_THRESHOLD', '3')),
    },
    erp: {
      latencyMs: Number(env('VITE_ERP_LATENCY_THRESHOLD', '3000')),
      errorRate: Number(env('VITE_ERP_ERROR_THRESHOLD', '0.08')),
      throughputMin: Number(env('VITE_ERP_THROUGHPUT_MIN', '1')),
      consecutiveRetries: Number(env('VITE_ERP_RETRY_THRESHOLD', '2')),
    },
  },
};
