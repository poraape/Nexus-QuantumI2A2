import { useState, useCallback, useRef } from 'react';
import { importFiles } from '../utils/importPipeline';
import { runAudit } from '../agents/auditorAgent';
import { runClassification } from '../agents/classifierAgent';
import { runAccountingAnalysis } from '../agents/accountantAgent';
import { startChat, sendMessageStream } from '../services/chatService';
import type { NfeData, ChatMessage, ImportedDoc, AuditReport } from '../types';
import type { Chat } from '@google/genai';
import Papa from 'papaparse';

export type PipelineStatus = 'idle' | 'ocr' | 'auditing' | 'classifying' | 'accounting' | 'ready' | 'error';
export interface AgentProgress {
  step: string;
  current: number;
  total: number;
}

const aggregateImportedData = (docs: ImportedDoc[]): NfeData => {
    let allCsvData: Record<string, any>[] = [];
    const fileDetails: { name: string; size: number }[] = [];
    let totalSize = 0;
    let fileCount = 0;

    for (const doc of docs) {
        if (doc.status === 'parsed' && doc.data) {
            allCsvData = allCsvData.concat(doc.data);
            fileDetails.push({ name: doc.name, size: doc.size });
            totalSize += doc.size;
            fileCount++;
        } else if (doc.status === 'ocr_needed' && doc.text) {
             // Basic text to CSV conversion for sample
             const lines = doc.text.split('\n').filter(line => line.trim() !== '');
             allCsvData.push({ 'extracted_text': lines.join('; ') });
             fileDetails.push({ name: doc.name, size: doc.size });
             totalSize += doc.size;
             fileCount++;
        }
    }
    
    const dataSample = Papa.unparse(allCsvData.slice(0, 200));

    return {
        fileCount,
        totalSize,
        fileDetails,
        dataSample,
    };
};


export const useAgentOrchestrator = () => {
    const [status, setStatus] = useState<PipelineStatus>('idle');
    const [progress, setProgress] = useState<AgentProgress>({ step: '', current: 0, total: 0 });
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const chatRef = useRef<Chat | null>(null);
    const streamController = useRef<AbortController | null>(null);

    const runPipeline = useCallback(async (files: FileList) => {
        setStatus('ocr');
        setError(null);
        setAuditReport(null);
        setMessages([]);
        chatRef.current = null;
        
        try {
            // 1. Agente OCR / Pipeline de Importação
            setProgress({ step: 'Agente OCR: Processando arquivos...', current: 0, total: files.length });
            const importedDocs = await importFiles(Array.from(files), (current, total) => {
                setProgress({ step: 'Agente OCR: Processando arquivos...', current, total });
            });
            
            if (importedDocs.every(d => d.status === 'unsupported' || d.status === 'error')) {
                throw new Error("Nenhum arquivo válido foi processado. Verifique os formatos de arquivo.");
            }
            
            // 2. Agente Auditor
            setStatus('auditing');
            setProgress({ step: 'Agente Auditor: Validando regras fiscais...', current: importedDocs.length, total: importedDocs.length });
            const initialReport = await runAudit(importedDocs);

            // 3. Agente Classificador (Placeholder)
            setStatus('classifying');
            setProgress({ step: 'Agente Classificador: Organizando operações...', current: 0, total: 0 });
            // This agent would enrich the report, for now it's a pass-through
            await runClassification();

            // 4. Agente Contador (Análise IA)
            setStatus('accounting');
            setProgress({ step: 'Agente Contador: Gerando análise com IA...', current: 0, total: 0 });
            
            // Build data sample only from valid documents for higher quality analysis
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

            // 5. Preparar para Chat
            chatRef.current = startChat(dataSampleForAI);
            setMessages([
                {
                    id: 'initial-ai-message',
                    sender: 'ai',
                    text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
                },
            ]);
            
            setStatus('ready');
            setProgress({ step: 'Pronto', current: 0, total: 0 });

        } catch (err: any) {
            console.error('Pipeline failed:', err);
            setError(err.message || 'Ocorreu um erro desconhecido.');
            setStatus('error');
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
            } else {
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === aiMessageId ? { ...msg, text: '[Geração de resposta interrompida]' } : msg
                    )
                );
            }
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            console.error('Chat stream failed:', err);
            const errorText = 'Desculpe, não consegui processar sua resposta. Tente novamente.';
            setMessages((prev) =>
                prev.map((msg) => (msg.id === aiMessageId ? { ...msg, text: errorText } : msg))
            );
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
    
    return {
        status,
        progress,
        auditReport,
        messages,
        isStreaming,
        error,
        runPipeline,
        handleSendMessage,
        handleStopStreaming,
        setError
    };
};
