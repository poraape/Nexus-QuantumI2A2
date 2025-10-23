import {
  createChatSession as createChatSessionBackend,
  generateJSON as generateJSONBackend,
  sendChatMessage as sendChatMessageBackend,
  type ChatSessionHandle,
  type ResponseSchema,
} from './llmService';

export type Chat = ChatSessionHandle;
export type { ResponseSchema };

export async function generateJSON<T = any>(
  model: string,
  prompt: string,
  schema: ResponseSchema,
  contextKey?: string,
): Promise<T> {
  const response = await generateJSONBackend<T>(model, prompt, schema, contextKey);
  return response;
}

export async function createChatSession(
  model: string,
  systemInstruction: string,
  schema: ResponseSchema,
): Promise<Chat> {
  return createChatSessionBackend(model, systemInstruction, schema);
}

export const sendChatMessage = sendChatMessageBackend;

export async function* streamChatMessage(chat: Chat, message: string): AsyncGenerator<string> {
  const response = await sendChatMessageBackend(chat, message);
  const text = typeof response.text === 'string' ? response.text : JSON.stringify(response);
  yield text;
}
