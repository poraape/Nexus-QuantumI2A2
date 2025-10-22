/**
 * @jest-environment node
 */

import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

const mockGenerateContent = jest.fn();
const mockChatCreate = jest.fn();
const mockChat = {
  sendMessageStream: jest.fn(),
};

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
    chats: {
      create: mockChatCreate.mockReturnValue(mockChat),
    },
  })),
}));

describe('Gemini proxy endpoints', () => {
  let app: typeof import('../index').app;
  let resetGeminiProxy: typeof import('../index').resetGeminiProxy;

  beforeEach(async () => {
    jest.resetModules();
    process.env.GEMINI_API_KEY = 'test-key';
    const module = await import('../index');
    app = module.app;
    resetGeminiProxy = module.resetGeminiProxy;
    resetGeminiProxy();
    mockGenerateContent.mockReset();
    mockChatCreate.mockClear();
    mockChat.sendMessageStream.mockReset();
  });

  afterEach(() => {
    resetGeminiProxy();
    delete process.env.GEMINI_API_KEY;
  });

  const withServer = async <T>(handler: (baseUrl: string) => Promise<T>) => {
    const server = app.listen(0);
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      return await handler(baseUrl);
    } finally {
      server.close();
      await once(server, 'close');
    }
  };

  it('proxies JSON generation requests to Gemini SDK', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ foo: 'bar' }) });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/llm/proxy/generate-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini', prompt: 'hello', schema: { type: 'object' } }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ text: JSON.stringify({ foo: 'bar' }) });
    });
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini',
      contents: 'hello',
      config: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'object' },
      },
    });
  });

  it('streams chat responses chunk by chunk', async () => {
    mockChat.sendMessageStream.mockResolvedValue((async function* () {
      yield { text: 'Olá' };
      yield { text: ', mundo!' };
    })());

    await withServer(async (baseUrl) => {
      const sessionResponse = await fetch(`${baseUrl}/api/llm/proxy/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini', systemInstruction: 'instr', schema: { type: 'object' } }),
      });

      expect(sessionResponse.status).toBe(200);
      const { sessionId } = await sessionResponse.json();
      expect(typeof sessionId).toBe('string');
      expect(mockChatCreate).toHaveBeenCalled();

      const streamResponse = await fetch(`${baseUrl}/api/llm/proxy/chat/sessions/${sessionId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'fala' }),
      });

      expect(streamResponse.status).toBe(200);
      const text = await streamResponse.text();
      expect(text).toBe('Olá\n, mundo!\n');
      expect(mockChat.sendMessageStream).toHaveBeenCalledWith({ message: 'fala' });
    });
  });

  it('returns 500 when Gemini key is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiProxy();

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/llm/proxy/generate-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(500);
    });
  });
});
