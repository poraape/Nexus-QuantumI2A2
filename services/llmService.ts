import { apiFetch } from './apiClient';
import { logger } from './logger';

export type ResponseSchema = Record<string, any>;

export interface ChatSessionHandle {
  sessionId: string;
  systemInstruction: string;
  schema: ResponseSchema;
  model?: string;
}

export async function generateJSON<T = any>(
  model: string,
  prompt: string,
  schema: ResponseSchema,
  contextKey?: string,
): Promise<T> {
  const response = await apiFetch<{ result: T }>(`/api/llm/generate-json`, {
    method: 'POST',
    body: JSON.stringify({ prompt, schema, model, context_key: contextKey }),
  });
  return response.result;
}

export async function createChatSession(
  model: string,
  systemInstruction: string,
  schema: ResponseSchema,
): Promise<ChatSessionHandle> {
  const response = await apiFetch<{ session_id: string }>(`/api/chat/sessions`, {
    method: 'POST',
    body: JSON.stringify({ model, system_instruction: systemInstruction, schema }),
  });
  return {
    sessionId: response.session_id,
    systemInstruction,
    schema,
    model,
  };
}

export async function sendChatMessage(
  session: ChatSessionHandle,
  message: string,
): Promise<Record<string, any>> {
  const response = await apiFetch<{ response: Record<string, any> }>(`/api/chat/sessions/${session.sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  logger.log('ChatService', 'INFO', 'Resposta do backend recebida com sucesso.');
  return response.response;
}
