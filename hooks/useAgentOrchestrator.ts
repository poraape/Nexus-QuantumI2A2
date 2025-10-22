import { useState, useCallback, useRef, useEffect } from 'react';
import { importFiles } from '../utils/importPipeline';
import { runAudit } from '../agents/auditorAgent';
import { runClassification } from '../agents/classifierAgent';
import { runIntelligenceAnalysis } from '../agents/intelligenceAgent';
import { runAccountingAnalysis } from '../agents/accountantAgent';
import { startChat, requestChatMessage, ChatSession } from '../services/chatService';
import type { ChatMessage, ImportedDoc, AuditReport, ClassificationResult } from '../types';
import Papa from 'papaparse';
import { logger } from '../services/logger';
import { runDeterministicCrossValidation } from '../utils/fiscalCompare';

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

const getDetailedErrorMessage = (error: unknown): string => {
    logger.log('ErrorHandler', 'ERROR', 'Analisando erro da aplicação.', { error });

    if (error instanceof Error) {
        if (error.name === 'TypeError' && error.message.toLowerCase().includes('failed to fetch')) {
            return 'Falha de conexão. Verifique sua internet ou possíveis problemas de CORS.';
        }

        const message = error.message.toLowerCase();
        if (message.includes('api key not valid')) {
            return 'Chave de API inválida. Verifique sua configuração.';
        }
        if (message.includes('quota')) {
            return 'Cota da API excedida. Por favor, tente novamente mais tarde.';
        }
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

export const useAgentOrchestrator = () => {
    const [agentStates, setAgentStates] = useState<AgentStates>(initialAgentStates);
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pipelineError, setPipelineError] = useState<boolean>(false);
    const [isPipelineComplete, setIsPipelineComplete] = useState(false);
    const [classificationCorrections, setClassificationCorrections] = useState<ClassificationCorrections>({});

    const chatRef = useRef<ChatSession | null>(null);

    useEffect(() => {
        try {
            const storedCorrections = localStorage.getItem(CORRECTIONS_STORAGE_KEY);
            if (storedCorrections) {
                setClassificationCorrections(JSON.parse(storedCorrections));
                logger.log('Orchestrator', 'INFO', `Carregadas ${Object.keys(JSON.parse(storedCorrections)).length} correções de classificação do localStorage.`);
            }
        } catch (e) {
            logger.log('Orchestrator', 'ERROR', 'Falha ao carregar correções do localStorage.', { error: e });
        }
    }, []);

    const reset = useCallback(() => {
        setAgentStates(initialAgentStates);
        setError(null);
        setPipelineError(false);
        setAuditReport(null);
        setMessages([]);
        chatRef.current = null;
        setIsPipelineComplete(false);
    }, []);

    const runPipeline = useCallback(async (files: File[]) => {
        logger.log('Orchestrator', 'INFO', 'Iniciando novo pipeline de análise.');
        reset();

        const updateAgentState = (agent: AgentName, status: AgentStatus, progress?: Partial<AgentProgress>) => {
            setAgentStates(prev => {
                const newState = { ...prev, [agent]: { status, progress: { ...prev[agent].progress, ...progress } } };
                if(status === 'running') logger.log(agent, 'INFO', `Iniciando - ${progress?.step || ''}`);
                if(status === 'completed') logger.log(agent, 'INFO', `Concluído.`);
                return newState;
            });
        };

        try {
            updateAgentState('ocr', 'running', { step: 'Processando arquivos...' });
            const importedDocs = await importFiles(files, (current, total) => {
                updateAgentState('ocr', 'running', { step: 'Processando arquivos...', current, total });
            });
            updateAgentState('ocr', 'completed');

            const isSingleZip = files.length === 1 && (files[0].name.toLowerCase().endsWith('.zip') || files[0].type.includes('zip'));
            const hasValidDocs = importedDocs.some(d => d.status !== 'unsupported' && d.status !== 'error');

            if (!hasValidDocs) {
                let errorMessage = "Nenhum arquivo válido foi processado. Verifique os formatos.";

                if (importedDocs.length === 1 && importedDocs[0].error) {
                    errorMessage = importedDocs[0].error;
                }
                else if (isSingleZip) {
                    errorMessage = "O arquivo ZIP está vazio ou não contém arquivos com formato suportado.";
                }

                throw new Error(errorMessage);
            }

            updateAgentState('auditor', 'running', { step: `Validando ${importedDocs.length} documentos...` });
            const auditedReport = await runAudit(importedDocs);
            updateAgentState('auditor', 'completed');

            updateAgentState('classifier', 'running', { step: 'Classificando operações...' });
            const classifiedReport = await runClassification(auditedReport, classificationCorrections);
            updateAgentState('classifier', 'completed');

            updateAgentState('crossValidator', 'running', { step: 'Executando validação cruzada...' });
            const deterministicCrossValidation = await runDeterministicCrossValidation(classifiedReport);
            const reportWithCrossValidation = { ...classifiedReport, deterministicCrossValidation };
            updateAgentState('crossValidator', 'completed');

            updateAgentState('intelligence', 'running', { step: 'Analisando padrões com IA...' });
            const { aiDrivenInsights, crossValidationResults } = await runIntelligenceAnalysis(reportWithCrossValidation);
            updateAgentState('intelligence', 'completed');

            updateAgentState('accountant', 'running', { step: 'Gerando análise com IA...' });
            const finalReport = await runAccountingAnalysis({ ...reportWithCrossValidation, aiDrivenInsights, crossValidationResults });
            setAuditReport(finalReport);
            updateAgentState('accountant', 'completed');

            const validDocsData = finalReport.documents
                .filter(d => d.status !== 'ERRO' && d.doc.data)
                .flatMap(d => d.doc.data!);
            const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));

            logger.log('ChatService', 'INFO', 'Iniciando sessão de chat com a IA.');
            chatRef.current = await startChat(dataSampleForAI, finalReport.aggregatedMetrics);
            setMessages([
                {
                    id: 'initial-ai-message',
                    sender: 'ai',
                    text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
                },
            ]);

        } catch (err: unknown) {
            console.error('Pipeline failed:', err);
            const errorMessage = getDetailedErrorMessage(err);
            setError(errorMessage);
            setPipelineError(true);
             const runningAgent = (Object.keys(agentStates) as AgentName[]).find(a => agentStates[a].status === 'running');
             if(runningAgent) {
                updateAgentState(runningAgent, 'error');
             }
        } finally {
            setIsPipelineComplete(true);
        }
    }, [classificationCorrections, agentStates]);

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
            setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, ...response, text: response.text ?? JSON.stringify(response) } : m));
        } catch (err: unknown) {
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
        } catch(e) {
            logger.log('Orchestrator', 'ERROR', `Falha ao salvar correção no localStorage.`, { error: e });
            setError('Não foi possível salvar a correção de classificação. Ela será perdida ao recarregar a página.');
        }

    }, [classificationCorrections]);

    return {
        agentStates,
        auditReport,
        setAuditReport,
        messages,
        isStreaming,
        error: error,
        isPipelineRunning: Object.values(agentStates).some(s => s.status === 'running'),
        isPipelineComplete,
        pipelineError,
        runPipeline,
        handleSendMessage,
        handleStopStreaming: () => {},
        setError,
        handleClassificationChange,
        reset,
    };
};
