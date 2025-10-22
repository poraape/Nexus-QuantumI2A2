import { getAccessToken, clearTokens } from '../authService';
import { logger } from '../logger';

jest.mock('../logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

describe('authService', () => {
  const originalFetch = global.fetch;
  const nowSpy = jest.spyOn(Date, 'now');

  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch;
    localStorage.clear();
    (logger.log as jest.Mock | undefined)?.mockClear?.();
    nowSpy.mockReturnValue(1_000_000);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch as typeof fetch;
    nowSpy.mockRestore();
  });

  it('requests a new backend session when none is cached', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'token-123', expiresAt: 1_000_000 + 60_000 }),
    });

    const token = await getAccessToken();

    expect(token).toBe('token-123');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/session'),
      expect.objectContaining({ method: 'POST' }),
    );
    const stored = JSON.parse(localStorage.getItem('nexus-access-token') ?? '{}');
    expect(stored.accessToken).toBe('token-123');
    expect(stored.expiresAt).toBe(1_000_000 + 60_000);
  });

  it('reuses cached session tokens when still valid', async () => {
    localStorage.setItem(
      'nexus-access-token',
      JSON.stringify({ accessToken: 'cached', expiresAt: 1_000_000 + 120_000 }),
    );

    const token = await getAccessToken();

    expect(token).toBe('cached');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requests a new session when the cached token is expired', async () => {
    localStorage.setItem(
      'nexus-access-token',
      JSON.stringify({ accessToken: 'old', expiresAt: 900_000 }),
    );

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'refreshed', expiresAt: 1_000_000 + 30_000 }),
    });

    const token = await getAccessToken();

    expect(token).toBe('refreshed');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(localStorage.getItem('nexus-access-token') ?? '{}');
    expect(stored.accessToken).toBe('refreshed');
  });

  it('clears tokens explicitly', () => {
    localStorage.setItem(
      'nexus-access-token',
      JSON.stringify({ accessToken: 'cached', expiresAt: 1_000_000 + 120_000 }),
    );

    clearTokens();

    expect(localStorage.getItem('nexus-access-token')).toBeNull();
  });

  it('throws when backend session endpoint fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(getAccessToken()).rejects.toThrow('Falha ao obter sessão autenticada.');
    expect(global.fetch).toHaveBeenCalled();
  });
});
