import { apiFetch } from './apiClient';

export async function sanitizeRecords<T extends Record<string, any>>(records: T[]): Promise<T[]> {
  const response = await apiFetch<{ records: T[] }>(`/api/sanitize`, {
    method: 'POST',
    body: JSON.stringify({ records }),
  });
  return response.records;
}
