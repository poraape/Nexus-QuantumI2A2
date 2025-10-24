import { act, renderHook } from '@testing-library/react';

import { useAgentOrchestrator, getDetailedErrorMessage } from '../useAgentOrchestrator';
import type { AuditReport, AuditedDocument } from '../../types';

const mockStartAnalysis = jest.fn();
const mockSubscribeToJobState = jest.fn();
const mockStartChat = jest.fn();
const mockRequestChatMessage = jest.fn();
const mockFetchCorrections = jest.fn();
const mockPersistCorrection = jest.fn();

jest.mock('../../services/backendClient', () => ({
  startAnalysis: (...args: any[]) => mockStartAnalysis(...args),
  subscribeToJobState: (...args: any[]) => mockSubscribeToJobState(...args),
  fetchClassificationCorrections: (...args: any[]) => mockFetchCorrections(...args),
  persistClassificationCorrection: (...args: any[]) => mockPersistCorrection(...args),
}));

jest.mock('../../services/chatService', () => ({
  startChat: (...args: any[]) => mockStartChat(...args),
  requestChatMessage: (...args: any[]) => mockRequestChatMessage(...args),
}));

jest.mock('../../services/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('../../services/telemetry', () => ({
  telemetry: {
    createCorrelationId: jest.fn().mockImplementation((scope: string) => `${scope}-${Date.now()}`),
  },
}));

jest.mock('papaparse', () => ({
  __esModule: true,
  default: {
    unparse: jest.fn().mockReturnValue('csv-data'),
  },
}));

describe('getDetailedErrorMessage', () => {
  it('handles fetch failures gracefully', () => {
    const typeError = new TypeError('Failed to fetch');
    expect(getDetailedErrorMessage(typeError)).toContain('Falha de conexão');
  });

  it('extracts status codes from error-like objects', () => {
    expect(getDetailedErrorMessage({ status: 503 })).toContain('503');
  });

  it('falls back to a default message for unknown structures', () => {
    expect(getDetailedErrorMessage(42)).toContain('desconhecido');
  });
});

describe('useAgentOrchestrator', () => {
  let lastSubscription: { onUpdate: (payload: any) => void; onError?: (error: unknown) => void } | null;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    lastSubscription = null;
    mockFetchCorrections.mockResolvedValue({ jobId: 'job-1', corrections: [] });
    mockPersistCorrection.mockResolvedValue({ jobId: 'job-1', corrections: [] });
    mockSubscribeToJobState.mockImplementation((_jobId: string, handlers: any) => {
      lastSubscription = handlers;
      return jest.fn();
    });
  });

  const buildReport = (): AuditReport => ({
    summary: {
      title: 'Resumo',
      summary: 'ok',
      keyMetrics: [],
      actionableInsights: [],
    },
    documents: [
      {
        doc: {
          kind: 'NFE_XML',
          name: 'doc-1.xml',
          size: 100,
          status: 'parsed',
          data: [{ produto_cfop: '5102', produto_ncm: '84715010', valor_total_nfe: '100' }],
        },
        status: 'OK',
        inconsistencies: [],
        classification: {
          operationType: 'Venda',
          businessSector: 'Tecnologia',
          confidence: 0.5,
        },
      },
    ],
    aggregatedMetrics: { total: 'R$ 100,00' },
  });

  const buildBackendStates = () => ({
    ocr: { status: 'completed', progress: { step: 'Processando', current: 1, total: 1 } },
    auditor: { status: 'completed', progress: { step: 'Validando', current: 1, total: 1 } },
    classifier: { status: 'completed', progress: { step: 'Classificando', current: 1, total: 1 } },
    crossValidator: { status: 'completed', progress: { step: 'Conferindo', current: 1, total: 1 } },
    intelligence: { status: 'completed', progress: { step: 'IA', current: 1, total: 1 } },
    accountant: { status: 'completed', progress: { step: 'Contabilizando', current: 1, total: 1 } },
  });

  it('runs the backend pipeline and hydrates the chat session', async () => {
    const report = buildReport();

    mockStartAnalysis.mockResolvedValue({
      jobId: 'job-1',
      status: 'running',
      agentStates: buildBackendStates(),
      result: null,
    });
    mockStartChat.mockResolvedValue({ sessionId: 'session-1' });

    const { result } = renderHook(() => useAgentOrchestrator());
    const file = new File(['content'], 'doc-1.xml', { type: 'text/xml' });

    await act(async () => {
      await result.current.runPipeline([file]);
      await Promise.resolve();
    });

    expect(mockStartAnalysis).toHaveBeenCalledWith([file]);
    expect(mockFetchCorrections).toHaveBeenCalledWith('job-1');
    expect(mockSubscribeToJobState).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ onUpdate: expect.any(Function) }),
    );

    await act(async () => {
      lastSubscription?.onUpdate?.({
        jobId: 'job-1',
        status: 'completed',
        agentStates: buildBackendStates(),
        result: report,
      });
      await Promise.resolve();
    });

    expect(result.current.auditReport?.summary.title).toBe('Resumo');
    expect(result.current.agentStates.auditor.status).toBe('completed');
    expect(result.current.isPipelineComplete).toBe(true);
    expect(mockStartChat).toHaveBeenCalled();
  });

  it('allows manual classification changes and persists corrections', async () => {
    const report = buildReport();

    mockStartAnalysis.mockResolvedValue({
      jobId: 'job-1',
      status: 'running',
      agentStates: buildBackendStates(),
      result: null,
    });
    mockStartChat.mockResolvedValue({ sessionId: 'session-1' });

    const { result } = renderHook(() => useAgentOrchestrator());
    const file = new File(['content'], 'doc-1.xml', { type: 'text/xml' });

    await act(async () => {
      await result.current.runPipeline([file]);
      await Promise.resolve();
    });

    await act(async () => {
      lastSubscription?.onUpdate?.({
        jobId: 'job-1',
        status: 'completed',
        agentStates: buildBackendStates(),
        result: report,
      });
      await Promise.resolve();
    });

    mockPersistCorrection.mockResolvedValue({
      jobId: 'job-1',
      corrections: [
        {
          documentName: 'doc-1.xml',
          operationType: 'Compra',
          createdBy: 'tester',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
    });

    await act(async () => {
      await result.current.handleClassificationChange('doc-1.xml', 'Compra');
    });

    const updatedDoc = result.current.auditReport?.documents[0] as AuditedDocument;
    expect(updatedDoc.classification?.operationType).toBe('Compra');
    expect(mockPersistCorrection).toHaveBeenCalledWith('job-1', 'doc-1.xml', 'Compra');
  });

  it('returns friendly error when chat is not initialized', async () => {
    const { result } = renderHook(() => useAgentOrchestrator());

    await act(async () => {
      await result.current.handleSendMessage('olá');
    });

    expect(result.current.error).toContain('não foi inicializado');
  });
});
