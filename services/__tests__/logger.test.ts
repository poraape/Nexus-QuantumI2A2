import { logger } from '../logger';

describe('LoggerService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ stored: 1, ingestToken: 'token-123' }),
    }) as unknown as typeof fetch;
    logger.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch as typeof fetch;
  });

  it('records logs and notifies subscribers', () => {
    const subscriber = jest.fn();
    logger.subscribe(subscriber);

    logger.log('Agent', 'INFO', 'message');

    const logs = logger.getLogs();
    expect(logs).toHaveLength(2); // includes clear() call
    expect(logs[1].message).toBe('message');
    expect(subscriber).toHaveBeenCalledTimes(2);

    logger.unsubscribe(subscriber);
    logger.log('Agent', 'WARN', 'second');
    expect(subscriber).toHaveBeenCalledTimes(2);
  });

  it('caps the number of log entries to avoid unbounded growth', () => {
    const limit = 600;
    for (let i = 0; i < limit; i++) {
      logger.log('Agent', 'INFO', `log-${i}`);
    }

    const logs = logger.getLogs();
    expect(logs.length).toBeLessThanOrEqual(500);
    expect(logs.at(-1)?.message).toBe('log-599');
  });
});
