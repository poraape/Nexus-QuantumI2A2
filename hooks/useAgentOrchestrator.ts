import { useState, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';

import { startChat, requestChatMessage, ChatSession } from '../services/chatService';
import type { ChatMessage, AuditReport, ClassificationResult } from '../types';
import { logger } from '../services/logger';
import { telemetry } from '../services/telemetry';
import {
  startAnalysis,
  subscribeToJobState,
  type AnalysisJobResponse,
  type BackendAgentState,
} from '../services/backendClient';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'crossValidator' | 'intelligence' | 'accountant';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'error';
export interface AgentProgress {
  step: string;
  current: number;
  total: number;
}
export type AgentState = { status: AgentStatus; progress: AgentProgress };
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

const CORRECTIONS_STORAGE_KEY = 'nexus-classification-corrections';

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

const normalizeAgentStates = (states?: Record<string, BackendAgentState | undefined>): AgentStates => {
  const base = cloneInitialAgentStates();
  if (!states) {
    return base;
  }

  Object.entries(states).forEach(([name, backendState]) => {
    if (!backendState) {
      return;
    }
    const typedName = name as AgentName;
    const progress = backendState.progress ?? { step: '', current: 0, total: 0 };
    (base as Record<string, AgentState>)[typedName] = {
      status: (backendState.status as AgentStatus) ?? 'pending',
      progress: {
        step: progress.step ?? '',
        current: progress.current ?? 0,
        total: progress.total ?? 0,
      },
    };
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
  const [classificationCorrections, setClassificationCorrections] = useState<ClassificationCorrections>({});

  const chatRef = useRef<ChatSession | null>(null);
  const chatJobIdRef = useRef<string | null>(null);
  const subscriptionAbortRef = useRef<AbortController | null>(null);
  const subscriptionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const correlationId = telemetry.createCorrelationId('backend');
    try {
      const storedCorrections = localStorage.getItem(CORRECTIONS_STORAGE_KEY);
      if (storedCorrections) {
        const parsed = JSON.parse(storedCorrections) as ClassificationCorrections;
        setClassificationCorrections(parsed);
        logger.log(
          'Orchestrator',
          'INFO',
          `Carregadas ${Object.keys(parsed).length} correções de classificação do localStorage.`,
          undefined,
          { correlationId, scope: 'backend' },
        );
      }
    } catch (e) {
      logger.log('Orchestrator', 'ERROR', 'Falha ao carregar correções do localStorage.', { error: e }, { correlationId, scope: 'backend' });
    }
  }, []);

  useEffect(() => () => {
    subscriptionAbortRef.current?.abort();
    subscriptionCleanupRef.current?.();
  }, []);

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

      setAgentStates(normalizeAgentStates(update.agentStates as Record<string, BackendAgentState | undefined>));

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
        setAuditReport((update.result ?? null) as AuditReport | null);
        if (update.result) {
          void initializeChatFromReport(update.result as AuditReport, update.jobId);
        }
      }
    },
    [initializeChatFromReport],
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

      const abortController = new AbortController();
      subscriptionAbortRef.current = abortController;

      try {
        const job = await startAnalysis(files);
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
    (docName: string, newClassification: ClassificationResult['operationType']) => {
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

      const newCorrections = { ...classificationCorrections, [docName]: newClassification };
      setClassificationCorrections(newCorrections);
      try {
        localStorage.setItem(CORRECTIONS_STORAGE_KEY, JSON.stringify(newCorrections));
        logger.log('Orchestrator', 'INFO', `Correção de classificação para '${docName}' salva.`, undefined, {
          correlationId: telemetry.createCorrelationId('backend'),
          scope: 'backend',
        });
      } catch (e) {
        logger.log('Orchestrator', 'ERROR', 'Falha ao salvar correção no localStorage.', { error: e }, {
          correlationId: telemetry.createCorrelationId('backend'),
          scope: 'backend',
        });
        setError('Não foi possível salvar a correção de classificação. Ela será perdida ao recarregar a página.');
      }
    },
    [classificationCorrections],
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
