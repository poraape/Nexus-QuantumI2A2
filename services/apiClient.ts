import { BACKEND_URL, ensureSession } from './authService';
import { logger } from './logger';

export async function apiFetch<TResponse = any>(
  path: string,
  options: RequestInit = {},
): Promise<TResponse> {
  await ensureSession();
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.text();
    logger.log('ApiClient', 'ERROR', `Requisição para ${path} falhou.`, { status: response.status, body });
    throw new Error(`Requisição para ${path} falhou com status ${response.status}.`);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<TResponse>;
  }
  return response.text() as unknown as TResponse;
}
