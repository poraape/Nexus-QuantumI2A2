import { useState, useCallback, useRef, useEffect } from 'react';
import { startChat, sendMessageStream } from '../services/chatService';
import type { ChatMessage, AuditReport, ClassificationResult } from '../types';
import type { Chat } from '@google/genai';
import Papa from 'papaparse';
import { logger } from '../services/logger';
import { fetchAnalysis, startAnalysis, type BackendAgentState } from '../services/backendClient';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'crossValidator' | 'intelligence' | 'accountant';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'error';
export interface AgentProgress {
  step: string;
  current: number;
  total: number;
}
export type AgentState = { status: AgentStatus; progress: AgentProgress; };
export type AgentStates = Record<AgentName, AgentState>;
type ClassificationCorrections = Record<string, ClassificationResult['operationType']>;

const initialAgentStates: AgentStates = {
    ocr: { status: 'pending', progress: { step: 'Aguardando arquivos', current: 0, total: 0 } },
    auditor: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    classifier: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    crossValidator: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    intelligence: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    accountant: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
};

const CORRECTIONS_STORAGE_KEY = 'nexus-classification-corrections';

const cloneInitialAgentStates = (): AgentStates => (
    Object.fromEntries(
        Object.entries(initialAgentStates).map(([agent, state]) => [
            agent,
            {
                status: state.status,
                progress: { ...state.progress },
            },
        ]),
    ) as AgentStates
);

const getDetailedErrorMessage = (error: unknown): string => {
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

    if (typeof error === 'string') {
        return error;
    }

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

const mapAgentStatesFromBackend = (backendStates: Record<string, BackendAgentState>): AgentStates => {
    const mapped = cloneInitialAgentStates();
    (Object.keys(mapped) as AgentName[]).forEach(agent => {
        const backendState = backendStates[agent];
        if (!backendState) return;
        mapped[agent] = {
            status: backendState.status,
            progress: {
                step: backendState.progress?.step ?? mapped[agent].progress.step,
                current: backendState.progress?.current ?? mapped[agent].progress.current ?? 0,
                total: backendState.progress?.total ?? mapped[agent].progress.total ?? 0,
            },
        };
    });
    return mapped;
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

    const chatRef = useRef<Chat | null>(null);
    const streamController = useRef<AbortController | null>(null);
    const pollIntervalRef = useRef<number | null>(null);

    useEffect(() => {
        try {
            const storedCorrections = localStorage.getItem(CORRECTIONS_STORAGE_KEY);
            if (storedCorrections) {
                const parsed = JSON.parse(storedCorrections);
                setClassificationCorrections(parsed);
                logger.log('Orchestrator', 'INFO', `Carregadas ${Object.keys(parsed).length} correções de classificação do localStorage.`);
            }
        } catch (e) {
            logger.log('Orchestrator', 'ERROR', 'Falha ao carregar correções do localStorage.', { error: e });
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
        setIsPipelineRunning(false);
        if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    }, []);

    const pollBackend = useCallback(async (analysisJobId: string) => {
        try {
            const status = await fetchAnalysis(analysisJobId);
            setAgentStates(mapAgentStatesFromBackend(status.agentStates));
            if (status.result) {
                setAuditReport(status.result);
            }

            if (status.status === 'completed' || status.status === 'failed') {
                setIsPipelineRunning(false);
                setIsPipelineComplete(true);
                setPipelineError(status.status === 'failed');
                if (status.error) {
                    setError(status.error);
                }
                if (pollIntervalRef.current) {
                    window.clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
            }
        } catch (err) {
            const errorMessage = getDetailedErrorMessage(err);
            setError(errorMessage);
            setPipelineError(true);
            setIsPipelineRunning(false);
            if (pollIntervalRef.current) {
                window.clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        }
    }, []);

    const runPipeline = useCallback(async (files: File[]) => {
        logger.log('Orchestrator', 'INFO', 'Iniciando novo pipeline de análise via backend.');
        reset();
        setIsPipelineRunning(true);

        try {
            const response = await startAnalysis(files);
            setAgentStates(mapAgentStatesFromBackend(response.agentStates));
            setPipelineError(false);
            setIsPipelineComplete(false);

            if (pollIntervalRef.current) {
                window.clearInterval(pollIntervalRef.current);
            }
            pollIntervalRef.current = window.setInterval(() => {
                if (!response.jobId) return;
                pollBackend(response.jobId).catch(err => {
                    const errorMessage = getDetailedErrorMessage(err);
                    setError(errorMessage);
                    setPipelineError(true);
                    setIsPipelineRunning(false);
                    if (pollIntervalRef.current) {
                        window.clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                });
            }, 4000);

            await pollBackend(response.jobId);
        } catch (err) {
            const errorMessage = getDetailedErrorMessage(err);
            setError(errorMessage);
            setPipelineError(true);
            setIsPipelineRunning(false);
        }
    }, [pollBackend, reset]);

    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                window.clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!auditReport) return;
        try {
            const validDocsData = auditReport.documents
                .filter(d => d.status !== 'ERRO' && d.doc.data)
                .flatMap(d => d.doc.data!);
            const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));
            logger.log('ChatService', 'INFO', 'Iniciando sessão de chat com a IA a partir do backend.');
            chatRef.current = startChat(dataSampleForAI, auditReport.aggregatedMetrics);
            setMessages([
                {
                    id: 'initial-ai-message',
                    sender: 'ai',
                    text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
                },
            ]);
        } catch (err) {
            logger.log('ChatService', 'ERROR', 'Falha ao preparar dados de chat.', { error: err });
        }
    }, [auditReport]);

    const handleStopStreaming = useCallback(() => {
        if (streamController.current) {
            streamController.current.abort();
            setIsStreaming(false);
            logger.log('ChatService', 'WARN', 'Geração de resposta do chat interrompida pelo usuário.');
        }
    }, []);

    const handleSendMessage = useCallback(async (message: string) => {
        if (!chatRef.current) {
            setError('O chat não foi inicializado. Por favor, execute uma análise primeiro.');
            return;
        }

        const userMessage: ChatMessage = { id: Date.now().toString(), sender: 'user', text: message };
        setMessages(prev => [...prev, userMessage]);
        setIsStreaming(true);

        const aiMessageId = (Date.now() + 1).toString();
        let fullAiResponse = '';
        setMessages(prev => [...prev, { id: aiMessageId, sender: 'ai', text: '...' }]);

        streamController.current = new AbortController();
        const signal = streamController.current.signal;

        try {
            const stream = sendMessageStream(chatRef.current, message);
            for await (const chunk of stream) {
                if (signal.aborted) break;
                fullAiResponse += chunk;
                setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: fullAiResponse } : m));
            }

            if (!signal.aborted) {
                try {
                    const finalJson = JSON.parse(fullAiResponse);
                    setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, ...finalJson } : m));
                } catch (parseError) {
                    logger.log('ChatService', 'ERROR', 'Falha ao analisar a resposta JSON final da IA.', { error: parseError, response: fullAiResponse });
                    const errorMessage = 'A IA retornou uma resposta em formato inválido. Por favor, tente novamente.';
                    setError(errorMessage);
                    setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: errorMessage } : m));
                }
            }

        } catch (err) {
            const finalMessage = getDetailedErrorMessage(err);
            setError(finalMessage);
            setMessages(prev => prev.filter(m => m.id !== aiMessageId));
        } finally {
            setIsStreaming(false);
            streamController.current = null;
        }
    }, []);

    const handleClassificationChange = useCallback((docName: string, newClassification: ClassificationResult['operationType']) => {
        setAuditReport(prevReport => {
            if (!prevReport) return null;
            const updatedDocs = prevReport.documents.map(doc => {
                if (doc.doc.name === docName && doc.classification) {
                    return {
                        ...doc,
                        classification: { ...doc.classification, operationType: newClassification, confidence: 1.0 }
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
            logger.log('Orchestrator', 'INFO', `Correção de classificação para '${docName}' salva.`);
        } catch (e) {
            logger.log('Orchestrator', 'ERROR', 'Falha ao salvar correção no localStorage.', { error: e });
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
        handleStopStreaming,
        setError,
        handleClassificationChange,
        reset,
    };
};
