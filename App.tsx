import React, { useState, useCallback, useRef, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import AnalysisDisplay from './components/AnalysisDisplay';
import ChatPanel from './components/ChatPanel';
import Header from './components/Header';
import Toast from './components/Toast';
import { processFiles } from './utils/fileUtils';
import { generateAnalysis, startChat, sendMessageStream } from './services/geminiService';
import type { AnalysisResult, NfeData, ChatMessage } from './types';
import { LoadingSpinnerIcon } from './components/icons';

const App: React.FC = () => {
  const [nfeData, setNfeData] = useState<NfeData | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // FIX: Improved type safety for the chat instance reference by using ReturnType.
  const chatRef = useRef<ReturnType<typeof startChat> | null>(null);
  const streamController = useRef<AbortController | null>(null);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const libsLoaded = !!(window.Papa && window.JSZip && window.jspdf && window.html2canvas);
      if (libsLoaded) {
        clearInterval(interval);
        setIsInitializing(false);
      } else if (Date.now() - startTime > 10000) { // 10s timeout
        clearInterval(interval);
        setError("Could not load required external libraries. Please check your connection and refresh.");
        setIsInitializing(false);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const handleFileUpload = useCallback(async (files: FileList) => {
    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);
    setNfeData(null);
    setMessages([]);
    chatRef.current = null;
    setProgress({ current: 0, total: files.length });

    try {
      const processedData = await processFiles(files, (current, total) => {
        setProgress({ current, total });
      });
      setNfeData(processedData);

      const analysis = await generateAnalysis(processedData.dataSample);
      setAnalysisResult(analysis);

      chatRef.current = startChat(processedData.dataSample);

      setMessages([
        {
          id: 'initial-ai-message',
          sender: 'ai',
          text: 'Sua análise inicial está pronta. Agora você pode me fazer perguntas sobre os detalhes dos dados.',
        },
      ]);
    } catch (err: any) {
      console.error('Processing or analysis failed:', err);
      setError(err.message || 'Ocorreu um erro desconhecido.');
    } finally {
      setIsLoading(false);
      setProgress({ current: 0, total: 0 });
    }
  }, []);

  const handleStopStreaming = useCallback(() => {
    if (streamController.current) {
        streamController.current.abort();
    }
    setIsStreaming(false);
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
         const finalAiResponse = JSON.parse(fullResponseText);
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

  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans">
      <Header />
      <main className="container mx-auto p-4 md:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
          <div className="flex flex-col gap-6 lg:gap-8">
            <FileUpload onFileUpload={handleFileUpload} disabled={isInitializing || isLoading} />
            {isInitializing && !error && (
                <div className="text-center text-sm text-gray-400 -mt-4">
                    Inicializando aplicação...
                </div>
            )}
            {isLoading && (
              <div className="bg-gray-800 p-6 rounded-lg shadow-lg flex flex-col items-center justify-center text-center">
                <LoadingSpinnerIcon className="w-12 h-12 animate-spin text-blue-400 mb-4" />
                <p className="text-lg font-semibold text-gray-200">Analisando seus dados...</p>
                <p className="text-sm text-gray-400">
                  {progress.total > 0
                    ? `Processando arquivo ${progress.current} de ${progress.total}...`
                    : 'Aguarde um momento.'}
                </p>
              </div>
            )}
            {analysisResult && !isLoading && <AnalysisDisplay result={analysisResult} fileInfo={nfeData} />}
          </div>
          <div className="lg:sticky lg:top-24">
            {analysisResult && !isLoading && (
              <ChatPanel messages={messages} onSendMessage={handleSendMessage} isStreaming={isStreaming} onStopStreaming={handleStopStreaming} />
            )}
          </div>
        </div>
      </main>
      {error && <Toast message={error} onClose={() => setError(null)} />}
    </div>
  );
};

export default App;
