import { logger } from './logger';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

interface SessionState {
  expiresAt: number;
}

let sessionState: SessionState | null = null;

function isExpired(state: SessionState | null): boolean {
  if (!state) return true;
  return Date.now() >= state.expiresAt - 30_000;
}

async function requestSession(): Promise<SessionState> {
  const response = await fetch(`${BACKEND_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Falha ao obter sessão autenticada.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    logger.log('AuthService', 'ERROR', 'Resposta inválida ao requisitar sessão.', { error });
    throw new Error('Falha ao interpretar resposta da sessão.');
  }

  const expiresAt = Number((payload as { expiresAt?: number | string })?.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('Resposta de sessão inválida.');
  }

  const state: SessionState = { expiresAt };
  sessionState = state;
  logger.log('AuthService', 'INFO', 'Sessão autenticada obtida via backend.');
  return state;
}

export async function ensureSession(): Promise<void> {
  if (isExpired(sessionState)) {
    await requestSession();
  }
}

export function getSessionExpiry(): number | null {
  return sessionState?.expiresAt ?? null;
}

export function clearSessionCache(): void {
  sessionState = null;
}

export { BACKEND_URL };
