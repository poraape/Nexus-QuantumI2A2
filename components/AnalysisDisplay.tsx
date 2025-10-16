import React, { useState, useRef } from 'react';
import type { AnalysisResult, NfeData } from '../types';
import { exportToMarkdown, exportToHtml, exportToPdf } from '../utils/exportUtils';
import { DownloadIcon, FileInfoIcon, MetricIcon, InsightIcon, LoadingSpinnerIcon } from './icons';

interface AnalysisDisplayProps {
  result: AnalysisResult;
  fileInfo: NfeData | null;
}

type ExportType = 'md' | 'html' | 'pdf';

const AnalysisDisplay: React.FC<AnalysisDisplayProps> = ({ result, fileInfo }) => {
  const [isExporting, setIsExporting] = useState<ExportType | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleExport = async (type: ExportType) => {
    if (!contentRef.current) return;
    setIsExporting(type);
    try {
      const { title } = result;
      const filename = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      
      switch (type) {
        case 'md':
          await exportToMarkdown(contentRef.current, filename);
          break;
        case 'html':
          await exportToHtml(contentRef.current, filename, title);
          break;
        case 'pdf':
          await exportToPdf(contentRef.current, filename);
          break;
      }
    } catch (error) {
      console.error(`Failed to export as ${type}:`, error);
    } finally {
      setIsExporting(null);
    }
  };
  
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
        <div className="flex space-x-2">
            {(['md', 'html', 'pdf'] as ExportType[]).map(type => (
                <button
                    key={type}
                    onClick={() => handleExport(type)}
                    disabled={!!isExporting}
                    className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait"
                    title={`Exportar para ${type.toUpperCase()}`}
                >
                    {isExporting === type ? <LoadingSpinnerIcon className="w-4 h-4 animate-spin"/> : <DownloadIcon className="w-4 h-4" />}
                </button>
            ))}
        </div>
      </div>
      
      <div ref={contentRef} className="text-gray-300 space-y-6">
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