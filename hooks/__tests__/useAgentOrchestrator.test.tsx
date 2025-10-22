import { act, renderHook } from '@testing-library/react';
import { useAgentOrchestrator, getDetailedErrorMessage } from '../useAgentOrchestrator';
import type { AuditReport, AuditedDocument } from '../../types';

const mockImportFiles = jest.fn();
const mockRunAudit = jest.fn();
const mockRunClassification = jest.fn();
const mockRunIntelligenceAnalysis = jest.fn();
const mockRunAccountingAnalysis = jest.fn();
const mockStartChat = jest.fn();
const mockSendMessageStream = jest.fn();
const mockRunDeterministicCrossValidation = jest.fn();

jest.mock('../../utils/importPipeline', () => ({
  importFiles: (...args: any[]) => mockImportFiles(...args),
}));

jest.mock('../../agents/auditorAgent', () => ({
  runAudit: (...args: any[]) => mockRunAudit(...args),
}));

jest.mock('../../agents/classifierAgent', () => ({
  runClassification: (...args: any[]) => mockRunClassification(...args),
}));

jest.mock('../../agents/intelligenceAgent', () => ({
  runIntelligenceAnalysis: (...args: any[]) => mockRunIntelligenceAnalysis(...args),
}));

jest.mock('../../agents/accountantAgent', () => ({
  runAccountingAnalysis: (...args: any[]) => mockRunAccountingAnalysis(...args),
}));

jest.mock('../../services/chatService', () => ({
  startChat: (...args: any[]) => mockStartChat(...args),
  sendMessageStream: (...args: any[]) => mockSendMessageStream(...args),
}));

jest.mock('../../services/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('../../utils/fiscalCompare', () => ({
  runDeterministicCrossValidation: (...args: any[]) => mockRunDeterministicCrossValidation(...args),
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
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
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
          data: [{ produto_cfop: '5102', produto_ncm: '84715010', valor_total_nfe: '100', produto_valor_total: '100' }],
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

  it('runs the pipeline end-to-end and prepares chat session', async () => {
    const reportWithoutSummary: Omit<AuditReport, 'summary'> = {
      documents: buildReport().documents,
      aggregatedMetrics: buildReport().aggregatedMetrics,
    };

    mockImportFiles.mockResolvedValue(reportWithoutSummary.documents.map((doc) => doc.doc));
    mockRunAudit.mockResolvedValue(reportWithoutSummary);
    mockRunClassification.mockResolvedValue(reportWithoutSummary);
    mockRunDeterministicCrossValidation.mockResolvedValue([]);
    mockRunIntelligenceAnalysis.mockResolvedValue({ aiDrivenInsights: [], crossValidationResults: [] });
    mockRunAccountingAnalysis.mockResolvedValue(buildReport());
    mockStartChat.mockReturnValue({});

    const { result } = renderHook(() => useAgentOrchestrator());

    const file = new File(['content'], 'doc-1.xml', { type: 'text/xml' });

    await act(async () => {
      await result.current.runPipeline([file]);
    });

    expect(result.current.auditReport?.summary.title).toBe('Resumo');
    expect(result.current.agentStates.auditor.status).toBe('completed');
    expect(result.current.isPipelineComplete).toBe(true);
    expect(mockStartChat).toHaveBeenCalled();
  });

  it('allows manual classification changes and persists corrections', async () => {
    const report = buildReport();
    mockImportFiles.mockResolvedValue(report.documents.map((doc) => doc.doc));
    mockRunAudit.mockResolvedValue({ documents: report.documents });
    mockRunClassification.mockResolvedValue({ documents: report.documents });
    mockRunDeterministicCrossValidation.mockResolvedValue([]);
    mockRunIntelligenceAnalysis.mockResolvedValue({ aiDrivenInsights: [], crossValidationResults: [] });
    mockRunAccountingAnalysis.mockResolvedValue(report);
    mockStartChat.mockReturnValue({});

    const { result } = renderHook(() => useAgentOrchestrator());
    const file = new File(['content'], 'doc-1.xml', { type: 'text/xml' });

    await act(async () => {
      await result.current.runPipeline([file]);
    });

    await act(async () => {
      result.current.handleClassificationChange('doc-1.xml', 'Compra');
    });

    const updatedDoc = result.current.auditReport?.documents[0] as AuditedDocument;
    expect(updatedDoc.classification?.operationType).toBe('Compra');
    expect(localStorage.getItem('nexus-classification-corrections')).toContain('Compra');
  });

  it('returns friendly error when chat is not initialized', async () => {
    const { result } = renderHook(() => useAgentOrchestrator());

    await act(async () => {
      await result.current.handleSendMessage('olá');
    });

    expect(result.current.error).toContain('não foi inicializado');
  });
});
