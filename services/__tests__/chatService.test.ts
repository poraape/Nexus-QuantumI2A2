import { startChat, sendMessageStream } from '../chatService';

type MockChat = { sendMessageStream: jest.Mock };

const mockCreateChatSession = jest.fn();
const mockStream = jest.fn();

jest.mock('../geminiService', () => ({
  createChatSession: (...args: any[]) => mockCreateChatSession(...args),
  streamChatMessage: (...args: any[]) => mockStream(...args),
}));

const fakeChat: MockChat = {
  sendMessageStream: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateChatSession.mockReturnValue(fakeChat);
});

describe('chatService', () => {
  it('starts chat sessions embedding aggregated metrics into the prompt', () => {
    const chat = startChat('sample-data', { total: 123 });
    expect(chat).toBe(fakeChat);
    expect(mockCreateChatSession).toHaveBeenCalledTimes(1);
    const [, instruction] = mockCreateChatSession.mock.calls[0];
    expect(instruction).toContain('sample-data');
    expect(instruction).toContain('"total": 123');
  });

  it('delegates streaming to geminiService', () => {
    const chat = {} as any;
    mockStream.mockReturnValue('stream');
    const result = sendMessageStream(chat, 'hello');
    expect(result).toBe('stream');
    expect(mockStream).toHaveBeenCalledWith(chat, 'hello');
  });
});
