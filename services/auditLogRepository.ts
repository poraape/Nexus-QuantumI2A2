import type { LogEntry } from './logger';

const isBrowser = typeof window !== 'undefined';
const AUDIT_LOG_FILE = 'audit_log.jsonl';

let nodeFs: typeof import('fs/promises') | null = null;
let nodePath: typeof import('path') | null = null;

interface PersistedLog extends LogEntry {
  id: string;
}

class AuditLogRepository {
  private cache: PersistedLog[] = [];
  private initialized = false;

  private async ensureFile() {
    if (this.initialized) return;

    if (isBrowser) {
      const raw = window.localStorage.getItem(AUDIT_LOG_FILE);
      this.cache = raw ? (JSON.parse(raw) as PersistedLog[]) : [];
      this.initialized = true;
      return;
    }

    if (!nodeFs) {
      nodeFs = await import('fs/promises');
    }
    if (!nodePath) {
      nodePath = await import('path');
    }

    const filePath = nodePath.join(process.cwd(), AUDIT_LOG_FILE);

    try {
      await nodeFs.access(filePath);
    } catch {
      await nodeFs.writeFile(filePath, '', 'utf-8');
    }

    try {
      const raw = await nodeFs.readFile(filePath, 'utf-8');
      this.cache = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PersistedLog);
    } catch {
      this.cache = [];
    }

    this.initialized = true;
  }

  private persistCache() {
    if (isBrowser) {
      window.localStorage.setItem(AUDIT_LOG_FILE, JSON.stringify(this.cache));
    }
  }

  async append(entry: LogEntry) {
    await this.ensureFile();
    const record: PersistedLog = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    this.cache.push(record);

    if (isBrowser) {
      this.persistCache();
      return;
    }

    if (!nodeFs || !nodePath) {
      throw new Error('fs module not initialized');
    }

    const filePath = nodePath.join(process.cwd(), AUDIT_LOG_FILE);
    await nodeFs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
  }

  async list(limit = 100) {
    await this.ensureFile();
    return this.cache.slice(-limit);
  }
}

export const auditLogRepository = new AuditLogRepository();
