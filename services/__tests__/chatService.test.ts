import { startChat, requestChatMessage } from '../chatService';

const mockCreateChatSession = jest.fn();
const mockSendChatMessage = jest.fn();

jest.mock('../llmService', () => ({
  createChatSession: (...args: any[]) => mockCreateChatSession(...args),
  sendChatMessage: (...args: any[]) => mockSendChatMessage(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateChatSession.mockResolvedValue({ sessionId: 'session-1', systemInstruction: '', schema: { type: 'object' } });
});

describe('chatService', () => {
  it('starts chat sessions embedding aggregated metrics into the prompt', async () => {
    const chat = await startChat('sample-data', { total: 123 });
    expect(chat).toEqual({ sessionId: 'session-1', systemInstruction: '', schema: { type: 'object' } });
    expect(mockCreateChatSession).toHaveBeenCalledTimes(1);
    const [, instruction, schema] = mockCreateChatSession.mock.calls[0];
    expect(instruction).toContain('sample-data');
    expect(instruction).toContain('"total": 123');
    expect(schema).toMatchObject({ type: 'object' });
  });

  it('delegates message sending to the unified llmService', async () => {
    mockSendChatMessage.mockResolvedValue({ text: 'ok' });
    const session = { sessionId: 'session-1', systemInstruction: '', schema: { type: 'object' } } as any;
    const response = await requestChatMessage(session, 'hello');
    expect(response).toEqual({ text: 'ok' });
    expect(mockSendChatMessage).toHaveBeenCalledWith(session, 'hello');
  });
});
