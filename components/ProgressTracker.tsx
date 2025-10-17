import React from 'react';
import type { PipelineStatus, AgentProgress } from '../hooks/useAgentOrchestrator';
import { CheckIcon, LoadingSpinnerIcon } from './icons';

const ProgressTracker: React.FC<{ status: PipelineStatus; progress: AgentProgress }> = ({ status, progress }) => {
    const steps = [
        { id: 'ocr', label: '1. Agente OCR' },
        { id: 'auditing', label: '2. Agente Auditor' },
        { id: 'classifying', label: '3. Agente Classificador' },
        { id: 'accounting', label: '4. Agente Contador' },
        { id: 'ready', label: '5. Pronto' },
    ];

    // Find the index of the current active step
    const currentStepIndex = steps.findIndex(step => status.startsWith(step.id));

    const isLoading = ['ocr', 'auditing', 'classifying', 'accounting'].includes(status);

    if (status === 'idle' || status === 'error') {
        return null;
    }

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg animate-fade-in">
            <h2 className="text-xl font-bold mb-4 text-gray-200">Progresso da Análise</h2>
            <div className="flex items-center justify-between mb-4">
                {steps.map((step, index) => {
                    const isCompleted = currentStepIndex > index || status === 'ready';
                    const isCurrent = currentStepIndex === index;
                    
                    return (
                        <React.Fragment key={step.id}>
                            <div className="flex items-center gap-2">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors
                                    ${isCompleted ? 'bg-teal-500' : isCurrent ? 'bg-blue-500' : 'bg-gray-700'}`}>
                                    {isCompleted ? <CheckIcon className="w-5 h-5 text-white" /> : isCurrent ? <LoadingSpinnerIcon className="w-5 h-5 text-white animate-spin" /> : <span className="text-gray-400 font-bold">{index + 1}</span>}
                                </div>
                                <span className={`font-semibold hidden sm:inline ${isCompleted || isCurrent ? 'text-gray-200' : 'text-gray-500'}`}>{step.label}</span>
                            </div>
                            {index < steps.length - 1 && <div className={`flex-1 h-1 mx-4 rounded ${isCompleted ? 'bg-teal-500' : 'bg-gray-700'}`}></div>}
                        </React.Fragment>
                    );
                })}
            </div>
             {isLoading && (
                 <div className="text-center text-sm text-gray-400">
                    <p>{progress.step}</p>
                    {progress.total > 0 && status === 'ocr' && (
                         <p>Arquivo {progress.current} de {progress.total}</p>
                    )}
                 </div>
            )}
        </div>
    );
};

export default ProgressTracker;
