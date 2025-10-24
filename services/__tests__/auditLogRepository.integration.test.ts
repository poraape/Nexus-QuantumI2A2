import type { LogEntry } from '../logger';

describe('AuditLogRepository integration', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('../authService');
  });

  afterAll(() => {
    global.fetch = originalFetch as typeof fetch;
  });

  it('envia lotes para a API sem utilizar localStorage', async () => {
    jest.doMock('../authService', () => ({
      ensureSession: jest.fn().mockResolvedValue(undefined),
      BACKEND_URL: 'http://localhost:8000',
    }));

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ stored: 1, ingestToken: 'ack-token' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const setItemSpy = jest.spyOn(window.localStorage, 'setItem');
    const getItemSpy = jest.spyOn(window.localStorage, 'getItem');
    const removeItemSpy = jest.spyOn(window.localStorage, 'removeItem');

    const { auditLogRepository } = await import('../auditLogRepository');

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      agent: 'tester',
      level: 'INFO',
      message: 'Evento crítico',
      metadata: { severity: 'critical' },
      correlationId: 'corr-1',
      scope: 'agent',
    };

    await auditLogRepository.append(entry);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/audit/logs');
    expect(options?.method).toBe('POST');
    expect(options?.credentials).toBe('include');
    const parsedBody = JSON.parse(options?.body as string);
    expect(Array.isArray(parsedBody.events)).toBe(true);
    expect(parsedBody.events[0].agent).toBe('tester');

    expect(window.localStorage.length).toBe(0);
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });
});
