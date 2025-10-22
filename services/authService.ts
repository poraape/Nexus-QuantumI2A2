import { logger } from './logger';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
const CLIENT_ID = import.meta.env.VITE_AUTH_CLIENT_ID ?? 'nexus-spa';
const USERNAME = import.meta.env.VITE_AUTH_USERNAME ?? '';
const PASSWORD = import.meta.env.VITE_AUTH_PASSWORD ?? '';

const TOKEN_KEY = 'nexus-auth-tokens';

type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const encoder = new TextEncoder();

function generateRandomString(length = 64): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  for (const value of randomValues) {
    result += charset[value % charset.length];
  }
  return result;
}

async function sha256(message: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(message));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadTokens(): TokenSet | null {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as TokenSet;
  } catch (error) {
    logger.log('AuthService', 'ERROR', 'Falha ao analisar tokens armazenados.', { error });
    return null;
  }
}

function storeTokens(tokens: TokenSet): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function isExpired(tokens: TokenSet | null): boolean {
  if (!tokens) return true;
  return Date.now() >= tokens.expiresAt - 30_000;
}

async function performLogin(): Promise<TokenSet> {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Credenciais de autenticação não configuradas.');
  }
  const codeVerifier = generateRandomString(86);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

  const authorizeResponse = await fetch(`${BACKEND_URL}/auth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
      code_challenge: codeChallenge,
      client_id: CLIENT_ID,
    }),
  });

  if (!authorizeResponse.ok) {
    throw new Error('Falha ao iniciar autorização OAuth2.');
  }
  const { code } = await authorizeResponse.json();

  const formData = new URLSearchParams();
  formData.set('grant_type', 'authorization_code');
  formData.set('code', code);
  formData.set('code_verifier', codeVerifier);
  formData.set('client_id', CLIENT_ID);

  const tokenResponse = await fetch(`${BACKEND_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });

  if (!tokenResponse.ok) {
    throw new Error('Falha ao trocar código por token.');
  }

  const tokenPayload = await tokenResponse.json() as { access_token: string; refresh_token: string };
  const expiresAt = Date.now() + 29 * 60 * 1000; // 29 minutos para margem
  const tokens: TokenSet = {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresAt,
  };
  storeTokens(tokens);
  logger.log('AuthService', 'INFO', 'Tokens OAuth2 obtidos com sucesso.');
  return tokens;
}

async function refresh(tokens: TokenSet): Promise<TokenSet> {
  const response = await fetch(`${BACKEND_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refreshToken }),
  });

  if (!response.ok) {
    throw new Error('Falha ao atualizar token.');
  }
  const payload = await response.json() as { access_token: string; refresh_token: string };
  const updated: TokenSet = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + 29 * 60 * 1000,
  };
  storeTokens(updated);
  logger.log('AuthService', 'INFO', 'Token atualizado com sucesso.');
  return updated;
}

export async function getAccessToken(): Promise<string> {
  let tokens = loadTokens();
  if (!tokens) {
    tokens = await performLogin();
    return tokens.accessToken;
  }
  if (isExpired(tokens)) {
    try {
      tokens = await refresh(tokens);
    } catch (error) {
      logger.log('AuthService', 'WARN', 'Refresh token inválido, efetuando novo login.', { error });
      tokens = await performLogin();
    }
  }
  return tokens.accessToken;
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export { BACKEND_URL };
