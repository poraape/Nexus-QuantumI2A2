import { useState, useCallback, useRef } from 'react';
import { importFiles } from '../utils/importPipeline';
import { runAudit } from '../agents/auditorAgent';
import { runClassification } from '../agents/classifierAgent';
import { runAccountingAnalysis } from '../agents/accountantAgent';
import { startChat, sendMessageStream } from '../services/chatService';
import type { ChatMessage, ImportedDoc, AuditReport } from '../types';
import type { Chat } from '@google/genai';
import Papa from 'papaparse';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'accountant';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'error';
export interface AgentProgress {
  step: string;
  current: number;
  total: number;
}
export type AgentState = { status: AgentStatus; progress: AgentProgress; };
export type AgentStates = Record<AgentName, AgentState>;

const initialAgentStates: AgentStates = {
    ocr: { status: 'pending', progress: { step: 'Aguardando arquivos', current: 0, total: 0 } },
    auditor: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    classifier: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    accountant: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
};

export const useAgentOrchestrator = () => {
    const [agentStates, setAgentStates] = useState<AgentStates>(initialAgentStates);
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pipelineError, setPipelineError] = useState<boolean>(false);

    const chatRef = useRef<Chat | null>(null);
    const streamController = useRef<AbortController | null>(null);

    const runPipeline = useCallback(async (files: FileList) => {
        setAgentStates(initialAgentStates);
        setError(null);
        setPipelineError(false);
        setAuditReport(null);
        setMessages([]);
        chatRef.current = null;
        
        try {
            const updateAgentState = (agent: AgentName, status: AgentStatus, progress?: Partial<AgentProgress>) => {
                setAgentStates(prev => ({
                    ...prev,
                    [agent]: {
                        status,
                        progress: { ...prev[agent].progress, ...progress }
                    }
                }));
            };

            // 1. Agente OCR
            updateAgentState('ocr', 'running', { step: 'Processando arquivos...' });
            const importedDocs = await importFiles(Array.from(files), (current, total) => {
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
            const initialReport = await runAudit(importedDocs);
            updateAgentState('auditor', 'completed');

            // 3. Agente Classificador
            updateAgentState('classifier', 'running', { step: 'Organizando operações...' });
            await runClassification();
            updateAgentState('classifier', 'completed');

            // 4. Agente Contador
            updateAgentState('accountant', 'running', { step: 'Gerando análise com IA...' });
            const validDocsData = initialReport.documents
                .filter(d => d.status !== 'ERRO' && d.doc.data)
                .flatMap(d => d.doc.data!);
                
            const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));

            if (dataSampleForAI.trim().length === 0) {
                 throw new Error("Não há dados válidos suficientes para gerar uma análise.");
            }

            const analysisSummary = await runAccountingAnalysis(dataSampleForAI);
            const finalReport = { ...initialReport, summary: analysisSummary };
            setAuditReport(finalReport);
            updateAgentState('accountant', 'completed');

            // 5. Preparar para Chat
            chatRef.current = startChat(dataSampleForAI);
            setMessages([
                {
                    id: 'initial-ai-message',
                    sender: 'ai',
                    text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
                },
            ]);

        } catch (err: any) {
            console.error('Pipeline failed:', err);
            setError(err.message || 'Ocorreu um erro desconhecido.');
            setPipelineError(true);
            setAgentStates(prev => {
                const newStates = { ...prev };
                const runningAgent = Object.keys(newStates).find(key => newStates[key as AgentName].status === 'running') as AgentName;
                if(runningAgent) {
                    newStates[runningAgent].status = 'error';
                }
                return newStates;
            });
        }
    }, []);

    const handleSendMessage = useCallback(async (message: string) => {
        if (!chatRef.current) {
            setError('O chat não foi iniciado. Por favor, faça o upload de arquivos primeiro.');
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

            // If the stream was not aborted, process the full response.
            // The AbortError is handled in the catch block.
            if (!signal.aborted) {
                // Robust JSON parsing: The model can sometimes stream a valid JSON followed by extra text.
                // This logic extracts the core JSON object before parsing to prevent errors.
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
        } catch (err) {
            // FIX: Correctly handle stream abortion and other errors with type guards.
            // This ensures the UI is updated appropriately when the user stops the stream.
            if (err instanceof Error && err.name === 'AbortError') {
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === aiMessageId ? { ...msg, text: '[Geração de resposta interrompida]' } : msg
                    )
                );
            } else {
                console.error('Chat stream failed:', err);
                const errorText = 'Desculpe, não consegui processar sua resposta. Tente novamente.';
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
        }
        setIsStreaming(false);
    }, []);

    const isPipelineRunning = Object.values(agentStates).some(s => s.status === 'running');
    const isPipelineComplete = agentStates.accountant.status === 'completed';
    
    return {
        agentStates,
        auditReport,
        messages,
        isStreaming,
        error,
        isPipelineRunning,
        isPipelineComplete,
        pipelineError,
        runPipeline,
        handleSendMessage,
        handleStopStreaming,
        setError
    };
};