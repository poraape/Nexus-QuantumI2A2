import { useState, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';

import type { ChatMessage, AuditReport, ClassificationResult } from '../types';
import { startChat, requestChatMessage, ChatSession } from '../services/chatService';
import { logger } from '../services/logger';
import { telemetry } from '../services/telemetry';
import {
  startAnalysis,
  fetchProgress,
  fetchAnalysis,
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

const POLL_INTERVAL_MS = 1500;
const CORRECTIONS_STORAGE_KEY = 'nexus-classification-corrections';

const agentNames: AgentName[] = ['ocr', 'auditor', 'classifier', 'crossValidator', 'intelligence', 'accountant'];

const defaultProgress: AgentProgress = { step: 'Aguardando arquivos', current: 0, total: 0 };

export const initialAgentStates: AgentStates = agentNames.reduce((acc, name) => {
  acc[name] = { status: 'pending', progress: { ...defaultProgress } };
  return acc;
}, {} as AgentStates);

export const cloneInitialAgentStates = (): AgentStates =>
  JSON.parse(JSON.stringify(initialAgentStates)) as AgentStates;

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const asAgentStatus = (status: string | undefined): AgentStatus => {
  if (status === 'running' || status === 'completed' || status === 'error') {
    return status;
  }
  return 'pending';
};

const normalizeAgentStates = (backendStates?: Record<string, BackendAgentState>): AgentStates => {
  const next = cloneInitialAgentStates();
  if (!backendStates) {
    return next;
  }

  agentNames.forEach(agent => {
    const backendState = backendStates[agent];
    if (!backendState) {
      return;
    }

    const progress = backendState.progress ?? {};
    const current = typeof progress.current === 'number' ? progress.current : 0;
    const total = typeof progress.total === 'number' ? progress.total : 0;
    const step = typeof progress.step === 'string' && progress.step.length > 0
      ? progress.step
      : next[agent].progress.step;

    next[agent] = {
      status: asAgentStatus(backendState.status as string | undefined),
      progress: {
        step,
        current,
        total,
      },
    };
  });

  return next;
};

const applyClassificationCorrections = (
  report: AuditReport | null,
  corrections: ClassificationCorrections,
): AuditReport | null => {
  if (!report) {
    return null;
  }

  if (!Object.keys(corrections).length) {
    return report;
  }

  return {
    ...report,
    documents: report.documents.map(doc => {
      const override = corrections[doc.doc.name];
      if (!override || !doc.classification) {
        return doc;
      }
      return {
        ...doc,
        classification: {
          ...doc.classification,
          operationType: override,
          confidence: 1,
        },
      };
    }),
  };
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
  const executionIdRef = useRef<string>('');
  const abortRef = useRef<boolean>(false);

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
    abortRef.current = true;
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setAgentStates(cloneInitialAgentStates());
    setError(null);
    setPipelineError(false);
    setAuditReport(null);
    setMessages([]);
    chatRef.current = null;
    setIsPipelineComplete(false);
    setIsPipelineRunning(false);
    executionIdRef.current = '';
  }, []);

  const hydrateChatSession = useCallback(async (finalReport: AuditReport, correlationId: string) => {
    const validDocsData = finalReport.documents
      .filter(d => d.status !== 'ERRO' && Array.isArray(d.doc.data) && d.doc.data.length > 0)
      .flatMap(d => d.doc.data!);

    if (!validDocsData.length) {
      logger.log('ChatService', 'WARN', 'Nenhum dado tabular disponível para iniciar o chat.', undefined, {
        correlationId,
        scope: 'llm',
      });
      return;
    }

    const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));
    logger.log('ChatService', 'INFO', 'Iniciando sessão de chat com a IA.', undefined, {
      correlationId,
      scope: 'llm',
    });
    chatRef.current = await startChat(dataSampleForAI, finalReport.aggregatedMetrics);
    setMessages([
      {
        id: 'initial-ai-message',
        sender: 'ai',
        text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
      },
    ]);
  }, []);

  const monitorJob = useCallback(async (jobId: string, correlationId: string): Promise<AnalysisJobResponse> => {
    let attempts = 0;
    while (!abortRef.current) {
      const progress = await fetchProgress(jobId);
      setAgentStates(normalizeAgentStates(progress.agentStates));

      if (progress.status === 'failed') {
        const message = progress.error ?? 'Falha na execução do pipeline.';
        throw new Error(message);
      }

      if (progress.status === 'completed') {
        const finalJob = await fetchAnalysis(jobId);
        setAgentStates(normalizeAgentStates(finalJob.agentStates));
        logger.log('Orchestrator', 'INFO', 'Pipeline concluído com sucesso.', undefined, {
          correlationId,
          scope: 'backend',
        });
        return finalJob;
      }

      attempts += 1;
      const backoff = Math.min(POLL_INTERVAL_MS * Math.max(1, attempts), 5000);
      await wait(backoff);
    }

    throw new Error('Pipeline interrompido.');
  }, []);

  const runPipeline = useCallback(async (files: File[]) => {
    const pipelineCorrelationId = telemetry.createCorrelationId('backend');
    abortRef.current = false;
    setIsPipelineRunning(true);
    setIsPipelineComplete(false);
    setPipelineError(false);
    setError(null);
    setAuditReport(null);
    setMessages([]);
    chatRef.current = null;
    setAgentStates(cloneInitialAgentStates());

    try {
      const startResponse = await startAnalysis(files);
      executionIdRef.current = startResponse.jobId;
      setAgentStates(normalizeAgentStates(startResponse.agentStates));

      const finalJob = await monitorJob(startResponse.jobId, pipelineCorrelationId);
      const correctedReport = applyClassificationCorrections(finalJob.result ?? null, classificationCorrections);
      if (correctedReport) {
        setAuditReport(correctedReport);
        executionIdRef.current = correctedReport.executionId ?? finalJob.jobId;
        await hydrateChatSession(correctedReport, pipelineCorrelationId);
      }
    } catch (err) {
      logger.log('Orchestrator', 'ERROR', 'Falha na execução do pipeline.', { error: err }, {
        correlationId: pipelineCorrelationId,
        scope: 'backend',
      });
      const errorMessage = getDetailedErrorMessage(err);
      setError(errorMessage);
      setPipelineError(true);
    } finally {
      setIsPipelineRunning(false);
      setIsPipelineComplete(true);
    }
  }, [classificationCorrections, hydrateChatSession, monitorJob]);

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

  const handleClassificationChange = useCallback((docName: string, newClassification: ClassificationResult['operationType']) => {
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
  }, [classificationCorrections]);

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

