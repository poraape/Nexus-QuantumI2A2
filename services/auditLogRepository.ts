import type { LogEntry } from './logger';

interface PersistedLog extends LogEntry {
  id: string;
}

interface BatchResponse {
  stored?: number;
  ingestToken?: string;
}

const MAX_RECENT_LOGS = 500;

let authModulePromise: Promise<typeof import('./authService')> | null = null;

async function resolveAuthModule() {
  if (!authModulePromise) {
    authModulePromise = import('./authService');
  }
  return authModulePromise;
}

function isFetchAvailable(): boolean {
  return typeof globalThis.fetch === 'function';
}

function createHeaders(ingestToken: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (ingestToken) {
    headers['X-Ingest-Token'] = ingestToken;
  }
  return headers;
}

async function parseResponse(response: Response): Promise<BatchResponse | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    return (await response.json()) as BatchResponse;
  } catch (error) {
    console.warn('Falha ao interpretar resposta da auditoria.', error);
    return null;
  }
}

function generateRecord(entry: LogEntry): PersistedLog {
  return {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

class AuditLogRepository {
  private pending: PersistedLog[] = [];
  private recent: PersistedLog[] = [];
  private ingestToken: string | null = null;
  private flushing: Promise<void> | null = null;

  async append(entry: LogEntry): Promise<void> {
    const record = generateRecord(entry);
    this.pending.push(record);
    this.recent.push(record);
    if (this.recent.length > MAX_RECENT_LOGS) {
      this.recent.splice(0, this.recent.length - MAX_RECENT_LOGS);
    }

    await this.flushPending();
  }

  async list(limit = 100): Promise<PersistedLog[]> {
    return this.recent.slice(-limit);
  }

  private async flushPending(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      return;
    }

    this.flushing = this.flushLoop();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  private async flushLoop(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0);
      try {
        await this.sendBatch(batch);
      } catch (error) {
        this.pending = [...batch, ...this.pending];
        throw error;
      }
    }
  }

  private async sendBatch(batch: PersistedLog[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    if (!isFetchAvailable()) {
      throw new Error('Fetch API indisponível para enviar auditoria.');
    }

    const { ensureSession, BACKEND_URL } = await resolveAuthModule();
    await ensureSession();

    const endpoint = `${BACKEND_URL.replace(/\/$/, '')}/api/audit/logs`;
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: createHeaders(this.ingestToken),
      body: JSON.stringify({ events: batch }),
    });

    if (!response.ok) {
      throw new Error(`Falha ao enviar auditoria (${response.status})`);
    }

    const parsed = await parseResponse(response);
    if (parsed?.ingestToken) {
      this.ingestToken = parsed.ingestToken;
    }
  }
}

export const auditLogRepository = new AuditLogRepository();
