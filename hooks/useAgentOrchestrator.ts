import { useState, useCallback, useRef, useEffect } from 'react';
import { importFiles } from '../utils/importPipeline';
import { runAudit } from '../agents/auditorAgent';
import { runClassification } from '../agents/classifierAgent';
import { runIntelligenceAnalysis } from '../agents/intelligenceAgent';
import { runAccountingAnalysis } from '../agents/accountantAgent';
import { startChat, requestChatMessage, ChatSession } from '../services/chatService';
import type { ChatMessage, AuditReport, ClassificationResult } from '../types';
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

const generateExecutionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `exec-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

  const reset = useCallback(() => {
    setAgentStates(cloneInitialAgentStates());
    setError(null);
    setPipelineError(false);
    setAuditReport(null);
    setMessages([]);
    chatRef.current = null;
    setIsPipelineComplete(false);
    executionIdRef.current = '';
  }, []);

  const runPipeline = useCallback(async (files: File[]) => {
    const pipelineCorrelationId = telemetry.createCorrelationId('backend');
    const agentCorrelations: Record<AgentName, string> = {
      ocr: telemetry.createCorrelationId('ocr', pipelineCorrelationId),
      auditor: telemetry.createCorrelationId('agent', pipelineCorrelationId),
      classifier: telemetry.createCorrelationId('agent', pipelineCorrelationId),
      crossValidator: telemetry.createCorrelationId('agent', pipelineCorrelationId),
      intelligence: telemetry.createCorrelationId('agent', pipelineCorrelationId),
      accountant: telemetry.createCorrelationId('agent', pipelineCorrelationId),
    };

    logger.log('Orchestrator', 'INFO', 'Iniciando novo pipeline de análise.', undefined, {
      correlationId: pipelineCorrelationId,
      scope: 'backend',
    });

    setIsPipelineRunning(true);
    setIsPipelineComplete(false);
    setPipelineError(false);
    setError(null);
    setAuditReport(null);
    setMessages([]);
    chatRef.current = null;
    setAgentStates(cloneInitialAgentStates());
    executionIdRef.current = generateExecutionId();

    const updateAgentState = (agent: AgentName, status: AgentStatus, progress?: Partial<AgentProgress>) => {
      setAgentStates(prev => {
        const next = {
          ...prev,
          [agent]: {
            status,
            progress: { ...prev[agent].progress, ...progress },
          },
        };
        const correlationId = agentCorrelations[agent];
        if (status === 'running') {
          logger.log(agent, 'INFO', progress?.step ?? 'Iniciando etapa.', undefined, { correlationId, scope: agent === 'ocr' ? 'ocr' : 'agent' });
        } else if (status === 'completed') {
          logger.log(agent, 'INFO', 'Etapa concluída.', undefined, { correlationId, scope: agent === 'ocr' ? 'ocr' : 'agent' });
        }
        return next;
      });
    };

    try {
      updateAgentState('ocr', 'running', { step: 'Processando arquivos...' });
      const importedDocs = await importFiles(
        files,
        (current, total) => updateAgentState('ocr', 'running', { step: 'Processando arquivos...', current, total }),
        agentCorrelations.ocr,
      );
      updateAgentState('ocr', 'completed');

      const isSingleZip = files.length === 1 && (files[0].name.toLowerCase().endsWith('.zip') || files[0].type.includes('zip'));
      const hasValidDocs = importedDocs.some(doc => doc.status !== 'unsupported' && doc.status !== 'error');
      if (!hasValidDocs) {
        let errorMessage = 'Nenhum arquivo válido foi processado. Verifique os formatos.';
        if (importedDocs.length === 1 && importedDocs[0].error) {
          errorMessage = importedDocs[0].error;
        } else if (isSingleZip) {
          errorMessage = 'O arquivo ZIP está vazio ou não contém arquivos com formato suportado.';
        }
        throw new Error(errorMessage);
      }

      updateAgentState('auditor', 'running', { step: `Validando ${importedDocs.length} documentos...` });
      const auditedReport = await runAudit(importedDocs, agentCorrelations.auditor);
      updateAgentState('auditor', 'completed');

      updateAgentState('classifier', 'running', { step: 'Classificando operações...' });
      const classifiedReport = await runClassification(auditedReport, classificationCorrections, agentCorrelations.classifier);
      updateAgentState('classifier', 'completed');

      updateAgentState('crossValidator', 'running', { step: 'Executando validação cruzada...' });
      const { findings: deterministicCrossValidation, artifacts: deterministicArtifacts } =
        await runDeterministicCrossValidation(classifiedReport, executionIdRef.current);
      const reportWithCrossValidation: AuditReport = {
        ...classifiedReport,
        deterministicCrossValidation,
        deterministicArtifacts,
        executionId: executionIdRef.current,
      };
      updateAgentState('crossValidator', 'completed');

      updateAgentState('intelligence', 'running', { step: 'Analisando padrões com IA...' });
      const { aiDrivenInsights, crossValidationResults } = await runIntelligenceAnalysis(reportWithCrossValidation, agentCorrelations.intelligence);
      updateAgentState('intelligence', 'completed');

      updateAgentState('accountant', 'running', { step: 'Gerando análise com IA...' });
      const finalReport = await runAccountingAnalysis(
        { ...reportWithCrossValidation, aiDrivenInsights, crossValidationResults },
        agentCorrelations.accountant,
      );
      setAuditReport(finalReport);
      updateAgentState('accountant', 'completed');

      const validDocsData = finalReport.documents
        .filter(d => d.status !== 'ERRO' && d.doc.data)
        .flatMap(d => d.doc.data!);
      const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));

      logger.log('ChatService', 'INFO', 'Iniciando sessão de chat com a IA.', undefined, {
        correlationId: pipelineCorrelationId,
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
    } catch (err) {
      console.error('Pipeline failed:', err);
      logger.log('Orchestrator', 'ERROR', 'Falha na execução do pipeline.', { error: err }, { correlationId: pipelineCorrelationId, scope: 'backend' });
      const errorMessage = getDetailedErrorMessage(err);
      setError(errorMessage);
      setPipelineError(true);
      setAgentStates(prev => {
        const runningAgent = (Object.keys(prev) as AgentName[]).find(agent => prev[agent].status === 'running');
        if (!runningAgent) return prev;
        return {
          ...prev,
          [runningAgent]: {
            ...prev[runningAgent],
            status: 'error',
          },
        };
      });
    } finally {
      setIsPipelineRunning(false);
      setIsPipelineComplete(true);
    }
  }, [classificationCorrections]);

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

