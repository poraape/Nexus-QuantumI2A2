import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import Chart from './Chart';
import { SendIcon, UserIcon, AiIcon, LoadingSpinnerIcon, StopIcon } from './icons';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isStreaming: boolean;
  onStopStreaming: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ messages, onSendMessage, isStreaming, onStopStreaming }) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      onSendMessage(input.trim());
      setInput('');
    }
  };
  
  const renderMessageContent = (message: ChatMessage) => {
    const html = message.text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\* (.*?)(?=\n\*|\n\n|$)/g, '<li class="ml-4 list-disc">$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

    return <div dangerouslySetInnerHTML={{ __html: html.replace(/\n/g, '<br />') }} />;
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg flex flex-col h-full max-h-[calc(100vh-12rem)] animate-fade-in">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-xl font-bold text-gray-200">3. Chat Interativo</h2>
      </div>
      <div className="flex-grow p-4 overflow-y-auto space-y-6">
        {messages.map((message) => (
          <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}>
            {message.sender === 'ai' && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center flex-shrink-0">
                <AiIcon className="w-5 h-5 text-white" />
              </div>
            )}
            <div className={`max-w-xl p-3 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-gray-700 text-gray-200 rounded-bl-none'
              }`}>
              <div className="prose prose-sm prose-invert max-w-none">
                 {isStreaming && message.id === messages[messages.length - 1].id ? <LoadingSpinnerIcon className="w-5 h-5 animate-spin" /> : renderMessageContent(message)}
              </div>
              {message.chartData && (
                <div className="mt-4 bg-gray-800/50 p-4 rounded-md" data-chart-container="true">
                  <Chart {...message.chartData} />
                </div>
              )}
            </div>
             {message.sender === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                <UserIcon className="w-5 h-5 text-gray-300" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t border-gray-700">
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? "Aguardando resposta..." : "Faça uma pergunta sobre os dados..."}
            disabled={isStreaming}
            className="flex-grow bg-gray-700 rounded-full py-2 px-4 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow disabled:opacity-50"
          />
          {isStreaming ? (
            <button
                type="button"
                onClick={onStopStreaming}
                className="bg-red-600 hover:bg-red-500 text-white rounded-full p-2.5 transition-colors"
                title="Parar geração"
            >
                <StopIcon className="w-5 h-5" />
            </button>
          ) : (
            <button
                type="submit"
                disabled={!input.trim()}
                className="bg-blue-600 hover:bg-blue-500 text-white rounded-full p-2.5 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
                <SendIcon className="w-5 h-5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default ChatPanel;