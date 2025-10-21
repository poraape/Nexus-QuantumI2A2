import { useState, useCallback, useRef, useEffect } from 'react';
import { importFiles } from '../utils/importPipeline';
import { runAudit } from '../agents/auditorAgent';
import { runClassification } from '../agents/classifierAgent';
import { runIntelligenceAnalysis } from '../agents/intelligenceAgent';
import { runAccountingAnalysis } from '../agents/accountantAgent';
import { startChat, sendMessageStream } from '../services/chatService';
import type { ChatMessage, ImportedDoc, AuditReport, ClassificationResult } from '../types';
import type { Chat } from '@google/genai';
import Papa from 'papaparse';
import { logger } from '../services/logger';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'intelligence' | 'accountant';
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
    intelligence: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    accountant: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
};

const CORRECTIONS_STORAGE_KEY = 'nexus-classification-corrections';

export const useAgentOrchestrator = () => {
    const [agentStates, setAgentStates] = useState<AgentStates>(initialAgentStates);
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pipelineError, setPipelineError] = useState<boolean>(false);
    const [isPipelineComplete, setIsPipelineComplete] = useState(false);
    const [classificationCorrections, setClassificationCorrections] = useState<ClassificationCorrections>({});

    const chatRef = useRef<Chat | null>(null);
    const streamController = useRef<AbortController | null>(null);
    
    // Load corrections from localStorage on initial mount
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
        // Don't clear logs on incremental runs, just reset pipeline state
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

            // 1. Agente OCR / NLP
            updateAgentState('ocr', 'running', { step: 'Processando arquivos...' });
            const importedDocs = await importFiles(files, (current, total) => {
                updateAgentState('ocr', 'running', { step: 'Processando arquivos...', current, total });
            });
            updateAgentState('ocr', 'completed');
            
            const isSingleZip = files.length === 1 && (files[0].name.toLowerCase().endsWith('.zip') || files[0].type.includes('zip'));
            const hasValidDocs = importedDocs.some(d => d.status !== 'unsupported' && d.status !== 'error');

            if (!hasValidDocs) {
                let errorMessage = "Nenhum arquivo válido foi processado. Verifique os formatos.";
            
                // If a single zip was uploaded and resulted in exactly one error document, use its specific error message.
                if (isSingleZip && importedDocs.length === 1 && importedDocs[0].error) {
                    errorMessage = importedDocs[0].error;
                } 
                // Fallback for a single zip that might have produced multiple error docs or an empty result.
                else if (isSingleZip) {
                    errorMessage = "O arquivo ZIP está vazio ou não contém arquivos com formato suportado.";
                }
            
                throw new Error(errorMessage);
            }
            
            // 2. Agente Auditor
            updateAgentState('auditor', 'running', { step: `Validando ${importedDocs.length} documentos...` });
            const auditedReport = await runAudit(importedDocs);
            if (!auditedReport || !auditedReport.documents?.length) {
                setPipelineError(true);
                const errMessage = 'Auditoria sem documentos válidos.';
                setError(errMessage);
                logger.log('Orchestrator', 'ERROR', 'runAudit vazio');
                updateAgentState('auditor', 'error');
                return;
            }
            updateAgentState('auditor', 'completed');

            // 3. Agente Classificador
            updateAgentState('classifier', 'running', { step: 'Classificando operações...' });
            const classifiedReport = await runClassification(auditedReport, classificationCorrections);
            updateAgentState('classifier', 'completed');

            // 4. Agente de Inteligência (IA)
            updateAgentState('intelligence', 'running', { step: 'Analisando padrões com IA...' });
            const { aiDrivenInsights, crossValidationResults } = await runIntelligenceAnalysis(classifiedReport);
            updateAgentState('intelligence', 'completed');

            // 5. Agente Contador
            updateAgentState('accountant', 'running', { step: 'Gerando análise com IA...' });
            const finalReport = await runAccountingAnalysis({ ...classifiedReport, aiDrivenInsights, crossValidationResults });
            setAuditReport(finalReport);
            updateAgentState('accountant', 'completed');
            
            const validDocsData = finalReport.documents
                .filter(d => d.status !== 'ERRO' && d.doc.data)
                .flatMap(d => d.doc.data!);
            const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));

            // 6. Preparar para Chat
            logger.log('ChatService', 'INFO', 'Iniciando sessão de chat com a IA.');
            chatRef.current = startChat(dataSampleForAI, finalReport.aggregatedMetrics);
            setMessages([
                {
                    id: 'initial-ai-message',
                    sender: 'ai',
                    text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
                },
            ]);

        } catch (err: unknown) {
            console.error('Pipeline failed:', err);
            let errorMessage = 'Ocorreu um erro desconhecido.';
            if (err instanceof Error) {
                errorMessage = err.message;
            } else if (typeof err === 'string') {
                errorMessage = err;
            } else if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
                errorMessage = (err as { message: string }).message;
            }
            setError(errorMessage);
            setPipelineError(true);
             const runningAgent = (Object.keys(agentStates) as AgentName[]).find(a => agentStates[a].status === 'running');
             if(runningAgent) {
                updateAgentState(runningAgent, 'error');
             }
        } finally {
            setIsPipelineComplete(true);
        }
    }, [classificationCorrections]); // Added dependency

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
                } catch(parseError) {
                     logger.log('ChatService', 'ERROR', 'Falha ao analisar a resposta JSON final da IA.', { error: parseError, response: fullAiResponse });
                     const errorMessage = 'A IA retornou uma resposta em formato inválido. Por favor, tente novamente.';
                     setError(errorMessage);
                     setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: errorMessage } : m));
                }
            }

        } catch (err: unknown) {
             let finalMessage = 'Ocorreu um erro na comunicação com a IA.';
            // FIX: Safely check for properties on an unknown error type, prioritizing specific checks.
            if (err instanceof Error) {
                finalMessage = err.message;
            } else if (err && typeof err === 'object') {
                if ('status' in err && typeof (err as { status: unknown }).status === 'number' && (err as { status: number }).status === 401) {
                    finalMessage = 'Chave de API inválida. Verifique sua configuração.';
                } else if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
                    finalMessage = (err as { message: string }).message;
                }
            }
            setError(finalMessage);
            setMessages(prev => prev.filter(m => m.id !== aiMessageId)); // Remove placeholder
        } finally {
            setIsStreaming(false);
            streamController.current = null;
        }
    }, [chatRef, messages]);

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
        
        // Update and save corrections for future runs
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
        handleStopStreaming,
        setError,
        handleClassificationChange,
        reset,
    };
};
