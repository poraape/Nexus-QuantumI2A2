import { generateJSON, createChatSession, streamChatMessage } from '../geminiService';
import { logger } from '../logger';

type MockedChat = {
  sendMessageStream: jest.Mock;
};

const mockGenerateContent = jest.fn();
const mockCreateChat = jest.fn();
const mockChat: MockedChat = {
  sendMessageStream: jest.fn(),
};

jest.mock('../logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
    chats: {
      create: mockCreateChat.mockReturnValue(mockChat),
    },
  })),
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
  },
}));

describe('geminiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses JSON responses and returns typed data', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ foo: 'bar' }) });
    const result = await generateJSON('model', 'prompt', { type: 'OBJECT' } as any);
    expect(result).toEqual({ foo: 'bar' });
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'model',
      contents: 'prompt',
      config: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT' },
      },
    });
  });

  it('throws when JSON is invalid and logs the failure', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'invalid json' });
    await expect(generateJSON('model', 'prompt', { type: 'OBJECT' } as any)).rejects.toThrow('A resposta da IA não estava em um formato JSON válido.');
    expect((logger.log as jest.Mock).mock.calls[0][2]).toContain('Falha na geração de JSON');
  });

  it('creates chat sessions with schema enforcement', () => {
    const schema = { type: 'OBJECT' } as any;
    const session = createChatSession('model', 'instructions', schema);
    expect(session).toBe(mockChat);
    expect(mockCreateChat).toHaveBeenCalledWith({
      model: 'model',
      config: {
        systemInstruction: 'instructions',
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });
  });

  it('streams chat responses chunk by chunk', async () => {
    async function* generator() {
      yield { text: 'Olá' };
      yield { text: ', mundo!' };
    }
    mockChat.sendMessageStream.mockResolvedValue(generator());

    const chunks: string[] = [];
    for await (const chunk of streamChatMessage(mockChat as any, 'msg')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Olá', ', mundo!']);
    expect(mockChat.sendMessageStream).toHaveBeenCalledWith({ message: 'msg' });
  });

  it('propagates errors during streaming with a friendly message', async () => {
    const error = new Error('boom');
    mockChat.sendMessageStream.mockRejectedValue(error);

    await expect(async () => {
      for await (const _ of streamChatMessage(mockChat as any, 'msg')) {
        void _;
      }
    }).rejects.toThrow('Desculpe, ocorreu um erro ao processar sua solicitação de chat.');
    expect((logger.log as jest.Mock).mock.calls[0][2]).toContain('Falha durante o streaming');
  });
});
