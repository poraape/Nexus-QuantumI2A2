import { TextEncoder } from 'util';

type FetchResponse = {
  ok: boolean;
  headers: Headers;
  json: jest.Mock;
  text: jest.Mock;
  body?: {
    getReader: () => {
      read: () => Promise<{ value?: Uint8Array; done: boolean }>;
      releaseLock: () => void;
    };
  };
};

jest.mock('../logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('../telemetry', () => ({
  telemetry: {
    createCorrelationId: jest.fn(() => 'cid-123'),
  },
}));

jest.mock('../resilience', () => ({
  executeWithResilience: jest.fn(async (_scope, _name, operation) => operation()),
}));

const encoder = new TextEncoder();

function mockJsonResponse(payload: Record<string, any>): FetchResponse {
  return {
    ok: true,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: jest.fn().mockResolvedValue(payload),
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

function mockStreamResponse(chunks: string[]): FetchResponse {
  let index = 0;
  const response: FetchResponse = {
    ok: true,
    headers: new Headers({ 'Content-Type': 'text/plain' }),
    json: jest.fn(),
    text: jest.fn(),
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) {
            return { done: true };
          }
          const value = encoder.encode(chunks[index]);
          index += 1;
          return { value, done: false };
        },
        releaseLock: () => undefined,
      }),
    },
  };
  return response;
}

describe('geminiService proxy integration', () => {
  const originalEnv = { ...process.env };
  const fetchMock = jest.fn();

  beforeEach(async () => {
    jest.resetModules();
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
    process.env = { ...originalEnv, GEMINI_PROXY_URL: 'http://proxy.test/api/llm/proxy' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('parses JSON responses received via the proxy', async () => {
    const response = mockJsonResponse({ text: JSON.stringify({ foo: 'bar' }) });
    fetchMock.mockResolvedValue(response);
    const { generateJSON } = await import('../geminiService');

    const result = await generateJSON('model', 'prompt', { type: 'object' });

    expect(result).toEqual({ foo: 'bar' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://proxy.test/api/llm/proxy/generate-json',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws a friendly error when the proxy returns invalid JSON text', async () => {
    const response = mockJsonResponse({ text: 'invalid-json' });
    fetchMock.mockResolvedValue(response);
    const { generateJSON } = await import('../geminiService');

    await expect(generateJSON('model', 'prompt', { type: 'object' })).rejects.toThrow(
      'A resposta da IA não estava em um formato JSON válido.'
    );
  });

  it('creates chat sessions via the proxy and exposes a streaming handle', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/chat/sessions')) {
        return Promise.resolve(mockJsonResponse({ sessionId: 'session-123' }));
      }
      if (url.endsWith('/chat/sessions/session-123/stream')) {
        return Promise.resolve(mockStreamResponse(['Olá\n', ', mundo!\n']));
      }
      return Promise.reject(new Error('Unexpected URL: ' + url));
    });

    const { createChatSession, streamChatMessage } = await import('../geminiService');
    const session = await createChatSession('model', 'instructions', { type: 'object' });

    const chunks: string[] = [];
    for await (const chunk of streamChatMessage(session, 'mensagem')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Olá', ', mundo!']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://proxy.test/api/llm/proxy/chat/sessions',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://proxy.test/api/llm/proxy/chat/sessions/session-123/stream',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('converts proxy streaming failures into a user-friendly error', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/chat/sessions')) {
        return Promise.resolve(mockJsonResponse({ sessionId: 'session-err' }));
      }
      if (url.endsWith('/chat/sessions/session-err/stream')) {
        const failure = mockJsonResponse({ error: 'fail' });
        failure.ok = false;
        failure.text.mockResolvedValue('proxy failure');
        return Promise.resolve(failure);
      }
      return Promise.reject(new Error('Unexpected URL: ' + url));
    });

    const { createChatSession, streamChatMessage } = await import('../geminiService');
    const session = await createChatSession('model', 'instructions', { type: 'object' });

    await expect(async () => {
      for await (const _ of streamChatMessage(session, 'ola')) {
        void _;
      }
    }).rejects.toThrow('Desculpe, ocorreu um erro ao processar sua solicitação de chat.');
  });
});
