import { auditLogRepository } from './auditLogRepository';
import { enrichWithCorrelation, telemetry, type TelemetryScope } from './telemetry';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  agent: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
  correlationId: string;
  scope: TelemetryScope;
}

interface LogOptions {
  correlationId?: string;
  scope?: TelemetryScope;
  persist?: boolean;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private subscribers: ((logs: LogEntry[]) => void)[] = [];
  private readonly MAX_LOGS = 500;

  log(agent: string, level: LogLevel, message: string, metadata?: Record<string, any>, options?: LogOptions) {
    const baseEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      agent,
      level,
      message,
      metadata,
      correlationId: options?.correlationId || '',
      scope: options?.scope || 'agent',
    };

    const entry = enrichWithCorrelation(baseEntry, options?.correlationId, options?.scope);

    if (this.logs.length >= this.MAX_LOGS) {
      this.logs.shift();
    }
    this.logs.push(entry);

    console.log(`[${entry.level}] (${entry.agent}) [${entry.correlationId}]: ${entry.message}`, entry.metadata || '');

    telemetry.emitLog(entry);

    if (options?.persist !== false) {
      auditLogRepository.append(entry).catch((error) => {
        console.error('Falha ao persistir log no audit trail.', error);
      });
    }

    this.notifySubscribers();
  }

  getLogs = (): LogEntry[] => {
    return this.logs;
  };

  subscribe = (callback: (logs: LogEntry[]) => void) => {
    this.subscribers.push(callback);
    callback(this.logs);
  };

  unsubscribe = (callback: (logs: LogEntry[]) => void) => {
    this.subscribers = this.subscribers.filter((cb) => cb !== callback);
  };

  clear = () => {
    this.logs = [];
    this.log('Logger', 'INFO', 'Log cache cleared.', undefined, { persist: false, scope: 'backend' });
    this.notifySubscribers();
  };

  private notifySubscribers() {
    this.subscribers.forEach((cb) => cb([...this.logs]));
  }
}

export const logger = new LoggerService();
