import { useState, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';

import { startChat, requestChatMessage, ChatSession } from '../services/chatService';
import type { ChatMessage, AuditReport, ClassificationResult } from '../types';
import { logger } from '../services/logger';
import { telemetry } from '../services/telemetry';
import {
  startAnalysis,
  subscribeToJobState,
  fetchClassificationCorrections,
  persistClassificationCorrection,
  type AnalysisJobResponse,
  type BackendAgentState,
  type ClassificationCorrectionRecord,
} from '../services/backendClient';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'crossValidator' | 'intelligence' | 'accountant';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'error';
export type AgentProgressExtra = Record<string, string | number | boolean>;

export interface AgentProgress {
  step: string;
  current: number;
  total: number;
  extra?: AgentProgressExtra;
  labels?: string[];
}
export type AgentState = {
  status: AgentStatus;
  progress: AgentProgress;
  details?: Record<string, unknown>;
};
export type AgentStates = Record<AgentName, AgentState>;
type ClassificationCorrections = Record<string, ClassificationResult['operationType']>;

export const initialAgentStates: AgentStates = {
  ocr: { status: 'pending', progress: { step: 'Aguardando arquivos', current: 0, total: 0 } },
  auditor: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  classifier: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  crossValidator: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  intelligence: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  accountant: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
};

export const cloneInitialAgentStates = (): AgentStates =>
  JSON.parse(JSON.stringify(initialAgentStates)) as AgentStates;

const PROGRESS_LABEL_DICTIONARY: Record<string, string> = {
  documents: 'Documentos processados',
  documentId: 'Documento',
  insight: 'Insight',
  issues: 'Inconsistências',
  comparisons: 'Comparações',
  recommendations: 'Recomendações',
  sections: 'Seções',
  icms_operations: 'Operações ICMS',
  confidence: 'Confiança',
  error: 'Erro',
};

const toTitleCase = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const formatExtraLabel = (key: string, value: string | number | boolean): string => {
  const label = PROGRESS_LABEL_DICTIONARY[key] ?? toTitleCase(key);
  if (typeof value === 'boolean') {
    return `${label}: ${value ? 'Sim' : 'Não'}`;
  }
  return `${label}: ${value}`;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneAgentStates = (states: AgentStates): AgentStates => {
  const entries = Object.entries(states).map(([agent, state]) => {
    const clonedState: AgentState = {
      status: state.status,
      progress: {
        step: state.progress.step,
        current: state.progress.current,
        total: state.progress.total,
        extra: state.progress.extra ? { ...state.progress.extra } : undefined,
        labels: state.progress.labels ? [...state.progress.labels] : undefined,
      },
      details: state.details ? { ...state.details } : undefined,
    };
    return [agent, clonedState];
  });
  return Object.fromEntries(entries) as AgentStates;
};

export const getDetailedErrorMessage = (error: unknown): string => {
  logger.log('ErrorHandler', 'ERROR', 'Analisando erro da aplicação.', { error });

  if (error instanceof Error) {
    if (error.name === 'TypeError' && error.message.toLowerCase().includes('failed to fetch')) {
      return 'Falha de conexão. Verifique sua internet ou possíveis problemas de CORS.';
    }

    const message = error.message.toLowerCase();
    if (message.includes('api key not valid')) return 'Chave de API inválida. Verifique sua configuração.';
    if (message.includes('quota')) return 'Cota da API excedida. Por favor, tente novamente mais tarde.';
    if (message.includes('400')) return 'Requisição inválida para a API. Verifique os dados enviados.';
    if (message.includes('401') || message.includes('permission denied')) return 'Não autorizado. Verifique sua chave de API e permissões.';
    if (message.includes('429')) return 'Muitas requisições. Por favor, aguarde e tente novamente.';
    if (message.includes('500') || message.includes('503')) return 'O serviço de IA está indisponível ou com problemas. Tente novamente mais tarde.';

    return error.message;
  }

  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
      const status = (error as { status: number }).status;
      return `Ocorreu um erro de rede ou API com o status: ${status}.`;
    }
  }

  return 'Ocorreu um erro desconhecido durante a operação.';
};

const normalizeAgentStates = (
  states?: Record<string, BackendAgentState | undefined>,
  previous?: AgentStates,
): AgentStates => {
  const fallbackInitial = cloneInitialAgentStates();
  const base = previous ? cloneAgentStates(previous) : cloneAgentStates(fallbackInitial);
  if (!states) {
    return base;
  }

  Object.entries(states).forEach(([name, backendState]) => {
    if (!backendState) {
      return;
    }

    const typedName = name as AgentName;
    const previousState = base[typedName] ?? fallbackInitial[typedName];
    const progressPayload = (backendState.progress ?? {}) as Record<string, unknown> & { extra?: unknown };
    const { step, current, total, extra: extraPayload, ...rest } = progressPayload;
    const normalizedProgress: AgentProgress = {
      step: typeof step === 'string' ? step : previousState.progress.step,
      current: typeof current === 'number' ? current : previousState.progress.current,
      total: typeof total === 'number' ? total : previousState.progress.total,
    };

    const hasExplicitExtras = extraPayload !== undefined || Object.keys(rest).length > 0;
    if (hasExplicitExtras) {
      const combinedExtras: Record<string, unknown> = {
        ...(isPlainRecord(extraPayload) ? extraPayload : {}),
        ...rest,
      };
      const sanitizedEntries = Object.entries(combinedExtras).filter(([, value]) =>
        value !== null && value !== undefined &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
      ) as [string, string | number | boolean][];

      if (sanitizedEntries.length > 0) {
        normalizedProgress.extra = sanitizedEntries.reduce<AgentProgressExtra>((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});
        normalizedProgress.labels = sanitizedEntries.map(([key, value]) => formatExtraLabel(key, value));
      } else {
        normalizedProgress.extra = undefined;
        normalizedProgress.labels = undefined;
      }
    } else if (previousState.progress.extra) {
      normalizedProgress.extra = { ...previousState.progress.extra };
      normalizedProgress.labels = previousState.progress.labels ? [...previousState.progress.labels] : undefined;
    }

    const nextState: AgentState = {
      status: (backendState.status as AgentStatus) ?? previousState.status,
      progress: normalizedProgress,
      details: backendState.details
        ? (isPlainRecord(backendState.details) ? { ...backendState.details } : previousState.details)
        : previousState.details,
    };

    (base as Record<string, AgentState>)[typedName] = nextState;
  });

  return base;
};

export const useAgentOrchestrator = () => {
  const [agentStates, setAgentStates] = useState<AgentStates>(cloneInitialAgentStates());
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState(false);
  const [isPipelineComplete, setIsPipelineComplete] = useState(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [classificationCorrections, setClassificationCorrections] = useState<ClassificationCorrections>({});
  const [, setCorrectionAuditTrail] = useState<Record<string, ClassificationCorrectionRecord>>({});

  const chatRef = useRef<ChatSession | null>(null);
  const chatJobIdRef = useRef<string | null>(null);
  const subscriptionAbortRef = useRef<AbortController | null>(null);
  const subscriptionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    subscriptionAbortRef.current?.abort();
    subscriptionCleanupRef.current?.();
  }, []);

  const applyCorrectionsToReport = useCallback(
    (report: AuditReport, corrections: ClassificationCorrections): AuditReport => {
      if (!report || Object.keys(corrections).length === 0) {
        return report;
      }

      let changed = false;
      const documents = report.documents.map(doc => {
        const correction = corrections[doc.doc.name];
        if (correction && doc.classification && doc.classification.operationType !== correction) {
          changed = true;
          return {
            ...doc,
            classification: { ...doc.classification, operationType: correction, confidence: 1.0 },
          };
        }
        return doc;
      });

      if (!changed) {
        return report;
      }

      return { ...report, documents };
    },
    [],
  );

  const syncCorrectionsFromRecords = useCallback(
    (records: ClassificationCorrectionRecord[]) => {
      const nextMap: ClassificationCorrections = {};
      const auditMap: Record<string, ClassificationCorrectionRecord> = {};

      records.forEach(record => {
        nextMap[record.documentName] = record.operationType;
        auditMap[record.documentName] = record;
      });

      setClassificationCorrections(nextMap);
      setCorrectionAuditTrail(auditMap);
      setAuditReport(prev => (prev ? applyCorrectionsToReport(prev, nextMap) : prev));
      return nextMap;
    },
    [applyCorrectionsToReport],
  );

  const loadCorrections = useCallback(
    async (jobId: string) => {
      const correlationId = telemetry.createCorrelationId('backend');
      try {
        const response = await fetchClassificationCorrections(jobId);
        const map = syncCorrectionsFromRecords(response.corrections);
        logger.log(
          'Orchestrator',
          'INFO',
          `Correções persistidas sincronizadas (${Object.keys(map).length}).`,
          undefined,
          { correlationId, scope: 'backend' },
        );
      } catch (err) {
        syncCorrectionsFromRecords([]);
        logger.log(
          'Orchestrator',
          'ERROR',
          'Falha ao carregar correções persistidas.',
          { error: err },
          { correlationId, scope: 'backend' },
        );
      }
    },
    [syncCorrectionsFromRecords],
  );

  const initializeChatFromReport = useCallback(
    async (report: AuditReport, jobId?: string) => {
      if (!jobId || chatJobIdRef.current === jobId) {
        return;
      }
      const correlationId = telemetry.createCorrelationId('llm');
      try {
        const validDocsData = report.documents
          .filter(doc => doc.status !== 'ERRO' && doc.doc.data)
          .flatMap(doc => doc.doc.data ?? []);
        const dataSample = validDocsData.length > 0 ? Papa.unparse(validDocsData.slice(0, 200)) : '';

        logger.log('ChatService', 'INFO', 'Iniciando sessão de chat com a IA.', undefined, {
          correlationId,
          scope: 'llm',
        });

        chatRef.current = await startChat(dataSample, report.aggregatedMetrics);
        chatJobIdRef.current = jobId;
        setMessages([
          {
            id: 'initial-ai-message',
            sender: 'ai',
            text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
          },
        ]);
      } catch (err) {
        logger.log('Orchestrator', 'ERROR', 'Falha ao inicializar chat pós-orquestração.', { error: err }, {
          correlationId,
          scope: 'backend',
        });
      }
    },
    [],
  );

  const applyBackendUpdate = useCallback(
    (update: AnalysisJobResponse) => {
      if (!update) {
        return;
      }

      if (update.jobId) {
        setCurrentJobId(prev => (prev === update.jobId ? prev : update.jobId));
      }

      if (update.agentStates) {
        setAgentStates(prev =>
          normalizeAgentStates(update.agentStates as Record<string, BackendAgentState | undefined>, prev),
        );
      }

      const status = update.status?.toLowerCase();
      if (status === 'completed') {
        setIsPipelineRunning(false);
        setIsPipelineComplete(true);
        setPipelineError(false);
      } else if (status === 'failed') {
        setIsPipelineRunning(false);
        setIsPipelineComplete(true);
        setPipelineError(true);
      } else if (status === 'running' || status === 'queued') {
        setIsPipelineRunning(true);
        setIsPipelineComplete(false);
        setPipelineError(false);
      }

      if (typeof update.error === 'string' && update.error.length > 0) {
        setError(update.error);
        setPipelineError(true);
      } else if (status === 'running' || status === 'queued') {
        setError(null);
      }

      if (Object.prototype.hasOwnProperty.call(update, 'result')) {
        const result = update.result as AuditReport | null | undefined;
        if (result) {
          const hydratedReport = applyCorrectionsToReport(result, classificationCorrections);
          setAuditReport(hydratedReport);
          void initializeChatFromReport(hydratedReport, update.jobId);
        } else {
          setAuditReport(null);
        }
      }
    },
    [applyCorrectionsToReport, classificationCorrections, initializeChatFromReport],
  );

  const resetSubscription = useCallback(() => {
    subscriptionAbortRef.current?.abort();
    subscriptionAbortRef.current = null;
    subscriptionCleanupRef.current?.();
    subscriptionCleanupRef.current = null;
  }, []);

  const runPipeline = useCallback(
    async (files: File[]) => {
      if (!files.length) {
        setError('Selecione ao menos um arquivo para iniciar a análise.');
        setPipelineError(true);
        return;
      }

      const correlationId = telemetry.createCorrelationId('backend');
      logger.log('Orchestrator', 'INFO', 'Iniciando novo pipeline de análise no backend.', undefined, {
        correlationId,
        scope: 'backend',
      });

      resetSubscription();
      chatRef.current = null;
      chatJobIdRef.current = null;

      setAgentStates(cloneInitialAgentStates());
      setError(null);
      setPipelineError(false);
      setAuditReport(null);
      setMessages([]);
      setIsPipelineComplete(false);
      setIsPipelineRunning(true);
      setCurrentJobId(null);
      syncCorrectionsFromRecords([]);

      const abortController = new AbortController();
      subscriptionAbortRef.current = abortController;

      try {
        const job = await startAnalysis(files);
        if (job.jobId) {
          setCurrentJobId(job.jobId);
          void loadCorrections(job.jobId);
        }
        applyBackendUpdate(job);

        subscriptionCleanupRef.current = subscribeToJobState(job.jobId, {
          onUpdate: applyBackendUpdate,
          onError: event => {
            logger.log('Orchestrator', 'WARN', 'Canal SSE indisponível. Alternando para polling automático.', { error: event }, {
              correlationId,
              scope: 'backend',
            });
          },
          signal: abortController.signal,
        });
      } catch (err) {
        logger.log('Orchestrator', 'ERROR', 'Falha ao iniciar pipeline no backend.', { error: err }, {
          correlationId,
          scope: 'backend',
        });
        const detailedMessage = getDetailedErrorMessage(err);
        setError(detailedMessage);
        setPipelineError(true);
        setIsPipelineRunning(false);
        setIsPipelineComplete(true);
        resetSubscription();
      }
    },
    [applyBackendUpdate, resetSubscription],
  );

  const handleSendMessage = useCallback(async (message: string) => {
    if (!chatRef.current) {
      setError('O chat não foi inicializado. Por favor, execute uma análise primeiro.');
      return;
    }

    const userMessage: ChatMessage = { id: Date.now().toString(), sender: 'user', text: message };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    const aiMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: aiMessageId, sender: 'ai', text: '...' }]);

    try {
      const response = await requestChatMessage(chatRef.current, message);
      const aiText = typeof response.text === 'string' ? response.text : JSON.stringify(response);
      setMessages(prev => prev.map(m => (m.id === aiMessageId ? { ...m, ...response, text: aiText } : m)));
    } catch (err) {
      const finalMessage = getDetailedErrorMessage(err);
      setError(finalMessage);
      setMessages(prev => prev.filter(m => m.id !== aiMessageId));
    } finally {
      setIsStreaming(false);
    }
  }, []);

  const handleClassificationChange = useCallback(
    async (docName: string, newClassification: ClassificationResult['operationType']) => {
      setAuditReport(prevReport => {
        if (!prevReport) return null;
        const updatedDocs = prevReport.documents.map(doc => {
          if (doc.doc.name === docName && doc.classification) {
            return {
              ...doc,
              classification: { ...doc.classification, operationType: newClassification, confidence: 1.0 },
            };
          }
          return doc;
        });
        return { ...prevReport, documents: updatedDocs };
      });

      setClassificationCorrections(prev => ({ ...prev, [docName]: newClassification }));

      if (!currentJobId) {
        logger.log('Orchestrator', 'WARN', `Correção aplicada sem jobId ativo para '${docName}'.`, undefined, {
          correlationId: telemetry.createCorrelationId('backend'),
          scope: 'backend',
        });
        return;
      }

      const correlationId = telemetry.createCorrelationId('backend');
      try {
        const response = await persistClassificationCorrection(currentJobId, docName, newClassification);
        syncCorrectionsFromRecords(response.corrections);
        logger.log('Orchestrator', 'INFO', `Correção de classificação para '${docName}' salva no backend.`, undefined, {
          correlationId,
          scope: 'backend',
        });
      } catch (err) {
        logger.log('Orchestrator', 'ERROR', 'Falha ao salvar correção no backend.', { error: err }, {
          correlationId,
          scope: 'backend',
        });
        setError('Não foi possível salvar a correção de classificação no servidor.');
      }
    },
    [currentJobId, setError, syncCorrectionsFromRecords],
  );

  const reset = useCallback(() => {
    resetSubscription();
    chatRef.current = null;
    chatJobIdRef.current = null;
    setAgentStates(cloneInitialAgentStates());
    setError(null);
    setPipelineError(false);
    setAuditReport(null);
    setMessages([]);
    setIsPipelineComplete(false);
    setIsPipelineRunning(false);
    setCurrentJobId(null);
    setClassificationCorrections({});
    setCorrectionAuditTrail({});
  }, [resetSubscription]);

  return {
    agentStates,
    auditReport,
    setAuditReport,
    messages,
    isStreaming,
    error,
    isPipelineRunning,
    isPipelineComplete,
    pipelineError,
    runPipeline,
    handleSendMessage,
    handleStopStreaming: () => undefined,
    setError,
    handleClassificationChange,
    reset,
  };
};
