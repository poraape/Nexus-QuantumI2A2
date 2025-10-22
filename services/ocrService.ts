import { apiFetch } from './apiClient';

export async function runOCR(buffer: ArrayBuffer, filename: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([buffer]);
  formData.append('file', blob, filename);
  const response = await apiFetch<{ text: string }>(`/api/ocr`, {
    method: 'POST',
    body: formData,
  });
  return response.text;
}
