import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  metrics,
  trace,
  Span,
  SpanStatusCode,
  Histogram,
  Counter,
  UpDownCounter,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { v4 as uuid } from 'uuid';
import { telemetryConfig } from '../telemetry/config';
import { sendAlert } from './telemetryAlerts';
import type { LogEntry } from './logger';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

type MetricCache = {
  latency: Record<string, Histogram>;
  errors: Record<string, Counter>;
  retries: Record<string, Counter>;
  throughput: Record<string, UpDownCounter>;
};

export type IntegrationScope = 'llm' | 'ocr' | 'erp';
export type TelemetryScope = IntegrationScope | 'agent' | 'backend';

export interface TelemetrySpanOptions {
  attributes?: Record<string, any>;
  scope?: TelemetryScope;
  correlationId?: string;
}

class TelemetryService {
  private tracerProvider?: WebTracerProvider;
  private meterProvider?: MeterProvider;
  private loggerProvider?: LoggerProvider;
  private initialized = false;
  private metricCache: MetricCache = {
    latency: {},
    errors: {},
    retries: {},
    throughput: {},
  };

  init() {
    if (this.initialized) return;

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: telemetryConfig.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: telemetryConfig.serviceVersion,
      'deployment.environment': telemetryConfig.environment,
    });

    const headers = telemetryConfig.otlpHeaders
      ? Object.fromEntries(
          telemetryConfig.otlpHeaders
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => entry.split('='))
        )
      : undefined;

    this.tracerProvider = new WebTracerProvider({ resource });
    const traceExporter = new OTLPTraceExporter({
      url: `${telemetryConfig.otlpEndpoint}/v1/traces`,
      headers,
    });
    this.tracerProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
    this.tracerProvider.register();

    this.meterProvider = new MeterProvider({ resource });
    const metricExporter = new OTLPMetricExporter({
      url: `${telemetryConfig.otlpEndpoint}/v1/metrics`,
      headers,
    });
    this.meterProvider.addMetricReader(
      new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 10000 })
    );
    metrics.setGlobalMeterProvider(this.meterProvider);

    this.loggerProvider = new LoggerProvider({ resource });
    const logExporter = new OTLPLogExporter({
      url: `${telemetryConfig.otlpEndpoint}/v1/logs`,
      headers,
    });
    this.loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
    logs.setGlobalLoggerProvider(this.loggerProvider);

    this.initialized = true;
  }

  getTracer() {
    if (!this.initialized) {
      this.init();
    }
    return trace.getTracer(telemetryConfig.serviceName);
  }

  getMeter(scope: string) {
    if (!this.initialized) {
      this.init();
    }
    return metrics.getMeter(scope);
  }

  getLogger(scope: string) {
    if (!this.initialized) {
      this.init();
    }
    return logs.getLogger(scope);
  }

  createCorrelationId(scope: TelemetryScope, parent?: string) {
    return parent ? `${parent}:${scope}:${uuid()}` : `${scope}:${uuid()}`;
  }

  startSpan(name: string, options: TelemetrySpanOptions = {}): Span {
    const tracer = this.getTracer();
    const correlationId = options.correlationId || this.createCorrelationId(options.scope || 'backend');

    const span = tracer.startSpan(name, {
      attributes: {
        'app.scope': options.scope,
        'correlation.id': correlationId,
        ...options.attributes,
      },
    });

    span.setAttribute('correlation.id', correlationId);

    return span;
  }

  runWithSpan<T>(name: string, fn: () => Promise<T> | T, options: TelemetrySpanOptions = {}): Promise<T> {
    const tracer = this.getTracer();
    const correlationId = options.correlationId || this.createCorrelationId(options.scope || 'backend');

    return tracer.startActiveSpan(
      name,
      {
        attributes: {
          'app.scope': options.scope,
          'correlation.id': correlationId,
          ...options.attributes,
        },
      },
      async (span) => {
        try {
          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  recordLatency(scope: TelemetryScope, name: string, durationMs: number, attributes?: Record<string, any>) {
    const meter = this.getMeter(scope);
    const key = `${scope}.${name}`;
    if (!this.metricCache.latency[key]) {
      this.metricCache.latency[key] = meter.createHistogram('latency_ms', {
        description: 'Tempo de resposta em milissegundos',
      });
    }
    this.metricCache.latency[key].record(durationMs, {
      scope,
      target: name,
      ...attributes,
    });
  }

  recordError(scope: TelemetryScope, name: string, attributes?: Record<string, any>) {
    const meter = this.getMeter(scope);
    const key = `${scope}.${name}`;
    if (!this.metricCache.errors[key]) {
      this.metricCache.errors[key] = meter.createCounter('error_rate', {
        description: 'Número de erros registrados',
      });
    }
    this.metricCache.errors[key].add(1, { scope, target: name, ...attributes });
  }

  recordRetry(scope: TelemetryScope, name: string, attributes?: Record<string, any>) {
    const meter = this.getMeter(scope);
    const key = `${scope}.${name}`;
    if (!this.metricCache.retries[key]) {
      this.metricCache.retries[key] = meter.createCounter('retries', {
        description: 'Número de tentativas de retry realizadas',
      });
    }
    this.metricCache.retries[key].add(1, { scope, target: name, ...attributes });
  }

  recordThroughput(scope: TelemetryScope, name: string, delta: number, attributes?: Record<string, any>) {
    const meter = this.getMeter(scope);
    const key = `${scope}.${name}`;
    if (!this.metricCache.throughput[key]) {
      this.metricCache.throughput[key] = meter.createUpDownCounter('throughput', {
        description: 'Itens processados por integração',
      });
    }
    this.metricCache.throughput[key].add(delta, { scope, target: name, ...attributes });
  }

  emitLog(entry: LogEntry) {
    const logger = this.getLogger(entry.agent || telemetryConfig.serviceName);
    logger.emit({
      severityText: entry.level,
      body: entry.message,
      attributes: {
        ...entry.metadata,
        timestamp: entry.timestamp,
        correlationId: entry.correlationId,
        scope: entry.scope,
      },
    });
  }

  async evaluateThresholds(scope: IntegrationScope, stats: {
    latencyMs?: number;
    errorRate?: number;
    throughput?: number;
    retries?: number;
  }) {
    const thresholds = telemetryConfig.thresholds[scope];
    if (!thresholds) return;

    const breaches: string[] = [];
    if (stats.latencyMs && stats.latencyMs > thresholds.latencyMs) {
      breaches.push(`latência ${stats.latencyMs.toFixed(0)}ms > ${thresholds.latencyMs}ms`);
    }
    if (stats.errorRate && stats.errorRate > thresholds.errorRate) {
      breaches.push(`taxa de erro ${(stats.errorRate * 100).toFixed(1)}% > ${(thresholds.errorRate * 100).toFixed(1)}%`);
    }
    if (stats.throughput && stats.throughput < thresholds.throughputMin) {
      breaches.push(`throughput ${stats.throughput} < ${thresholds.throughputMin}`);
    }
    if (stats.retries && stats.retries >= thresholds.consecutiveRetries) {
      breaches.push(`retries consecutivos ${stats.retries} >= ${thresholds.consecutiveRetries}`);
    }

    if (breaches.length > 0) {
      await sendAlert(scope, breaches);
    }
  }
}

export const telemetry = new TelemetryService();

export interface ExecutionTimings {
  start: number;
  end: number;
  duration: number;
}

export async function measureExecution<T>(scope: TelemetryScope, name: string, fn: () => Promise<T> | T, options: TelemetrySpanOptions = {}) {
  const start = performance.now();
  try {
    const result = await telemetry.runWithSpan(name, fn, { ...options, scope });
    const end = performance.now();
    telemetry.recordLatency(scope, name, end - start, options.attributes);
    telemetry.recordThroughput(scope, name, 1, options.attributes);
    if (scope === 'llm' || scope === 'ocr' || scope === 'erp') {
      await telemetry.evaluateThresholds(scope, { latencyMs: end - start, throughput: 1 });
    }
    return result;
  } catch (error) {
    const end = performance.now();
    telemetry.recordError(scope, name, { error: (error as Error).message });
    if (scope === 'llm' || scope === 'ocr' || scope === 'erp') {
      await telemetry.evaluateThresholds(scope, { latencyMs: end - start, errorRate: 1 });
    }
    throw error;
  }
}

export function enrichWithCorrelation(entry: LogEntry, correlationId?: string, scope: TelemetryScope = 'agent'): LogEntry {
  return {
    ...entry,
    correlationId: correlationId || telemetry.createCorrelationId(scope),
    scope,
  };
}
