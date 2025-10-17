import React from 'react';
import type { AnalysisResult, NfeData } from '../types';
import { FileInfoIcon, MetricIcon, InsightIcon } from './icons';

interface AnalysisDisplayProps {
  result: AnalysisResult;
  fileInfo: NfeData | null;
}

const AnalysisDisplay: React.FC<AnalysisDisplayProps> = ({ result, fileInfo }) => {
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg animate-fade-in">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-xl font-bold text-gray-200">2. Análise Executiva</h2>
      </div>
      
      <div className="text-gray-300 space-y-6">
        <h3 data-export-title className="text-lg font-semibold text-blue-400">{result.title}</h3>
        
        {fileInfo && (
            <div className="bg-gray-700/50 p-4 rounded-md">
                <h4 className="flex items-center text-md font-semibold text-gray-300 mb-2"><FileInfoIcon className="w-5 h-5 mr-2 text-gray-400"/>Informações dos Arquivos</h4>
                <p className="text-sm">
                    {fileInfo.fileCount} arquivos processados, totalizando {formatBytes(fileInfo.totalSize)}.
                </p>
            </div>
        )}

        <p className="text-sm leading-relaxed">{result.summary}</p>
        
        <div>
          <h4 className="flex items-center text-md font-semibold text-gray-300 mb-3"><MetricIcon className="w-5 h-5 mr-2 text-gray-400"/>Métricas Chave</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
            {result.keyMetrics.map((item, index) => (
              <div key={index} className="bg-gray-700/50 p-4 rounded-md">
                <p className="font-bold text-lg text-teal-300">{item.value}</p>
                <p className="text-sm font-semibold text-gray-300">{item.metric}</p>
                <p className="text-xs text-gray-400 mt-1">{item.insight}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="flex items-center text-md font-semibold text-gray-300 mb-3"><InsightIcon className="w-5 h-5 mr-2 text-gray-400"/>Insights Acionáveis</h4>
          <ul className="list-disc list-inside space-y-2 text-sm">
            {result.actionableInsights.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AnalysisDisplay;