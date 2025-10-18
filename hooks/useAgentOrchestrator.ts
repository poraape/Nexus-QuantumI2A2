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
        
        try {
            const updateAgentState = (agent: AgentName, status: AgentStatus, progress?: Partial<AgentProgress>) => {
                setAgentStates(prev => {
                    const newState = { ...prev, [agent]: { status, progress: { ...prev[agent].progress, ...progress } } };
                    if(status === 'running') logger.log(agent, 'INFO', `Iniciando - ${progress?.step || ''}`);
                    if(status === 'completed') logger.log(agent, 'INFO', `Concluído.`);
                    return newState;
                });
            };

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
                if (isSingleZip) {
                    errorMessage = "O arquivo ZIP está vazio ou não contém arquivos com formato suportado.";
                }
                throw new Error(errorMessage);
            }
            
            // 2. Agente Auditor
            updateAgentState('auditor', 'running', { step: `Validando ${importedDocs.length} documentos...` });
            const auditedReport = await runAudit(importedDocs);
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
            // FIX: Refactored error handling to safely extract the error message from various possible thrown types.
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
             const runningAgent = (Object.keys(agentStates) as AgentName[]).find(key => agentStates[key].status === 'running') || 'Orchestrator';
            logger.log(runningAgent, 'ERROR', `Falha no pipeline: ${errorMessage}`, { error: err });

            setAgentStates(prev => {
                const newStates = { ...prev };
                if(runningAgent && newStates[runningAgent]) {
                    newStates[runningAgent].status = 'error';
                }
                return newStates;
            });
        } finally {
            setIsPipelineComplete(true);
        }
    }, [classificationCorrections, reset]);

    const handleSendMessage = useCallback(async (message: string) => {
        if (!chatRef.current) {
            setError('O chat não foi iniciado. Por favor, faça o upload de arquivos primeiro.');
            logger.log('ChatPanel', 'ERROR', 'Tentativa de envio de mensagem sem chat iniciado.');
            return;
        }

        const userMessage: ChatMessage = { id: Date.now().toString(), sender: 'user', text: message };
        setMessages((prev) => [...prev, userMessage]);
        setIsStreaming(true);

        streamController.current = new AbortController();
        const signal = streamController.current.signal;

        const aiMessageId = (Date.now() + 1).toString();
        setMessages((prev) => [...prev, { id: aiMessageId, sender: 'ai', text: '' }]);

        try {
            let fullResponseText = '';
            const stream = sendMessageStream(chatRef.current, message);
            for await (const chunk of stream) {
                if (signal.aborted) break;
                fullResponseText += chunk;
            }

            if (!signal.aborted) {
                let jsonString = fullResponseText.trim();
                const jsonStart = jsonString.indexOf('{');
                const jsonEnd = jsonString.lastIndexOf('}');

                if (jsonStart !== -1 && jsonEnd > jsonStart) {
                    jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
                }
                
                const finalAiResponse = JSON.parse(jsonString);
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === aiMessageId
                            ? { ...msg, text: finalAiResponse.text, chartData: finalAiResponse.chartData }
                            : msg
                    )
                );
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') {
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === aiMessageId ? { ...msg, text: '[Geração de resposta interrompida]' } : msg
                    )
                );
            } else {
                console.error('Chat stream failed:', err);
                // FIX: Refactored error handling to safely extract the error message from various possible thrown types.
                let errorText = 'Desculpe, não consegui processar sua resposta. Tente novamente.';
                if (err instanceof Error) {
                    errorText = err.message;
                } else if (typeof err === 'string') {
                    errorText = err;
                } else if (err && typeof err === 'object') {
                    // Safely check for a message property.
                    if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
                        errorText = (err as { message: string }).message;
                    }
                    // FIX: Safely check for and access the 'status' property on the unknown error object.
                    if ('status' in err) {
                        // FIX: Replaced direct property access on an 'unknown' error object with a safer type assertion to `Record<string, unknown>` to resolve the TypeScript error 'Property 'status' does not exist on type 'unknown''. This ensures type safety when accessing properties on caught errors of unknown shape.
                        const status = (err as Record<string, unknown>).status;
                        if (typeof status === 'string' || typeof status === 'number') {
                            errorText += ` (Status: ${status})`;
                        }
                    }
                }
                 logger.log('ChatService', 'ERROR', 'Falha no stream do chat', { error: err });
                setMessages((prev) =>
                    prev.map((msg) => (msg.id === aiMessageId ? { ...msg, text: errorText } : msg))
                );
            }
        } finally {
            setIsStreaming(false);
            streamController.current = null;
        }
    }, []);

    const handleStopStreaming = useCallback(() => {
        if (streamController.current) {
            streamController.current.abort();
            logger.log('ChatPanel', 'INFO', 'Geração de resposta interrompida pelo usuário.');
        }
        setIsStreaming(false);
    }, []);

     const handleClassificationChange = useCallback((docName: string, newClassification: ClassificationResult['operationType']) => {
        const updatedCorrections = { ...classificationCorrections, [docName]: newClassification };
        setClassificationCorrections(updatedCorrections);

        try {
            localStorage.setItem(CORRECTIONS_STORAGE_KEY, JSON.stringify(updatedCorrections));
        } catch (e) {
             logger.log('Orchestrator', 'ERROR', 'Falha ao salvar correções no localStorage.', { error: e });
        }

        // Update the report in state to reflect the change immediately
        setAuditReport(prevReport => {
            if (!prevReport) return null;
            const newDocs = prevReport.documents.map(doc => {
                if (doc.doc.name === docName && doc.classification) {
                    return { ...doc, classification: { ...doc.classification, operationType: newClassification }};
                }
                return doc;
            });
            return { ...prevReport, documents: newDocs };
        });
        logger.log('Orchestrator', 'INFO', `Classificação do documento '${docName}' corrigida para '${newClassification}'.`);
    }, [classificationCorrections]);


    const isPipelineRunning = Object.values(agentStates).some(s => s.status === 'running');
    
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