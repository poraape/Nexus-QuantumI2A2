import { ensureSession, clearSessionCache, getSessionExpiry } from '../authService';
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
    (logger.log as jest.Mock | undefined)?.mockClear?.();
    clearSessionCache();
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
      json: async () => ({ expiresAt: 1_000_000 + 60_000 }),
    });

    await ensureSession();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/session'),
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    );
    expect(getSessionExpiry()).toBe(1_000_000 + 60_000);
  });

  it('reuses cached session metadata when still valid', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ expiresAt: 1_000_000 + 120_000 }),
    });

    await ensureSession();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    (global.fetch as jest.Mock).mockClear();
    nowSpy.mockReturnValue(1_000_000 + 30_000);

    await ensureSession();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requests a new session when metadata is expired', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ expiresAt: 1_000_000 + 10_000 }),
    });

    await ensureSession();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    (global.fetch as jest.Mock).mockClear();
    nowSpy.mockReturnValue(1_000_000 + 60_001);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ expiresAt: 1_000_000 + 120_000 }),
    });

    await ensureSession();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getSessionExpiry()).toBe(1_000_000 + 120_000);
  });

  it('clears cached state explicitly', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ expiresAt: 1_000_000 + 60_000 }),
    });

    await ensureSession();
    clearSessionCache();

    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ expiresAt: 1_000_000 + 120_000 }),
    });

    await ensureSession();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when backend session endpoint fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(ensureSession()).rejects.toThrow('Falha ao obter sessão autenticada.');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('throws when backend response payload is invalid', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ wrong: true }),
    });

    await expect(ensureSession()).rejects.toThrow('Resposta de sessão inválida.');
  });
});
