const mockGenerateJSON = jest.fn();
const mockCreateChatSession = jest.fn();
const mockSendChatMessage = jest.fn();

jest.mock('../llmService', () => ({
  generateJSON: (...args: any[]) => mockGenerateJSON(...args),
  createChatSession: (...args: any[]) => mockCreateChatSession(...args),
  sendChatMessage: (...args: any[]) => mockSendChatMessage(...args),
}));

describe('geminiService delegations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates JSON generation to the consolidated llmService', async () => {
    mockGenerateJSON.mockResolvedValue({ foo: 'bar' });
    const { generateJSON } = await import('../geminiService');

    const result = await generateJSON('model', 'prompt', { type: 'object' });

    expect(result).toEqual({ foo: 'bar' });
    expect(mockGenerateJSON).toHaveBeenCalledWith('model', 'prompt', { type: 'object' }, undefined);
  });

  it('delegates chat session creation', async () => {
    const fakeSession = { sessionId: 'session-1', systemInstruction: 'instr', schema: { type: 'object' } };
    mockCreateChatSession.mockResolvedValue(fakeSession);
    const { createChatSession } = await import('../geminiService');

    const session = await createChatSession('model', 'instr', { type: 'object' });

    expect(session).toBe(fakeSession);
    expect(mockCreateChatSession).toHaveBeenCalledWith('model', 'instr', { type: 'object' });
  });

  it('wraps sendChatMessage responses into a simple async generator', async () => {
    mockSendChatMessage.mockResolvedValue({ text: 'olá mundo' });
    const { streamChatMessage } = await import('../geminiService');

    const chunks: string[] = [];
    for await (const chunk of streamChatMessage(
      { sessionId: 'session-1', systemInstruction: 'instr', schema: { type: 'object' } },
      'mensagem',
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['olá mundo']);
    expect(mockSendChatMessage).toHaveBeenCalledWith(
      { sessionId: 'session-1', systemInstruction: 'instr', schema: { type: 'object' } },
      'mensagem',
    );
  });
});
