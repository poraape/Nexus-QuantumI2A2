import { logger } from './logger';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
const TOKEN_KEY = 'nexus-access-token';

type SessionToken = {
  accessToken: string;
  expiresAt: number;
};

function loadSession(): SessionToken | null {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as SessionToken;
  } catch (error) {
    logger.log('AuthService', 'ERROR', 'Falha ao analisar tokens armazenados.', { error });
    return null;
  }
}

function storeSession(tokens: SessionToken): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function isExpired(session: SessionToken | null): boolean {
  if (!session) return true;
  return Date.now() >= session.expiresAt - 30_000;
}

async function requestSession(): Promise<SessionToken> {
  const response = await fetch(`${BACKEND_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Falha ao obter sessão autenticada.');
  }

  const payload = await response.json() as { accessToken?: string; expiresAt?: number };
  const expiresAt = Number(payload.expiresAt);
  if (!payload.accessToken || Number.isNaN(expiresAt) || expiresAt <= 0) {
    throw new Error('Resposta de sessão inválida.');
  }

  const session: SessionToken = {
    accessToken: payload.accessToken,
    expiresAt,
  };
  storeSession(session);
  logger.log('AuthService', 'INFO', 'Sessão autenticada obtida via backend.');
  return session;
}

export async function getAccessToken(): Promise<string> {
  let session = loadSession();
  if (!session || isExpired(session)) {
    session = await requestSession();
  }
  return session.accessToken;
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export { BACKEND_URL };
