import React, { useState } from 'react';
import type { AuditReport, AuditedDocument, AuditStatus } from '../types';
import { 
    MetricIcon, 
    InsightIcon, 
    ShieldCheckIcon, 
    ShieldExclamationIcon, 
    ChevronDownIcon,
    FileIcon
} from './icons';

const statusStyles: { [key in AuditStatus]: { badge: string; icon: React.ReactNode; text: string; } } = {
    OK: {
        badge: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
        icon: <ShieldCheckIcon className="w-5 h-5 text-teal-400" />,
        text: 'OK'
    },
    ALERTA: {
        badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
        icon: <ShieldExclamationIcon className="w-5 h-5 text-yellow-400" />,
        text: 'Alerta'
    },
    ERRO: {
        badge: 'bg-red-500/20 text-red-300 border-red-500/30',
        icon: <ShieldExclamationIcon className="w-5 h-5 text-red-400" />,
        text: 'Erro'
    }
};

const DocumentItem: React.FC<{ item: AuditedDocument }> = ({ item }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const { doc, status, inconsistencies } = item;
    const style = statusStyles[status];

    const hasDetails = inconsistencies.length > 0;

    return (
        <div className="bg-gray-700/50 rounded-lg">
            <div 
                className={`flex items-center p-3 ${hasDetails ? 'cursor-pointer' : ''}`}
                onClick={() => hasDetails && setIsExpanded(!isExpanded)}
            >
                {style.icon}
                <span className="truncate mx-3 flex-1 text-gray-300 text-sm">{doc.name}</span>
                <div className="flex items-center gap-3 ml-auto">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${style.badge}`}>
                        {style.text}
                    </span>
                    {hasDetails && (
                        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                </div>
            </div>
            {isExpanded && hasDetails && (
                 <div className="border-t border-gray-600/50 p-4 animate-fade-in-down">
                    <h5 className="font-semibold text-sm mb-2 text-gray-300">Inconsistências Encontradas:</h5>
                    <ul className="space-y-3">
                        {inconsistencies.map((inc, index) => (
                             <li key={index} className="text-xs border-l-2 border-yellow-500/50 pl-3">
                                <p className="font-semibold text-yellow-300">{inc.message} <span className="text-gray-500 font-mono">({inc.code})</span></p>
                                <p className="text-gray-400 mt-1">
                                    <span className="font-semibold">XAI:</span> {inc.explanation}
                                </p>
                            </li>
                        ))}
                    </ul>
                 </div>
            )}
        </div>
    );
};


const ReportViewer: React.FC<{ report: AuditReport }> = ({ report }) => {
  const { summary, documents } = report;

  const docStats = documents.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
  }, {} as Record<AuditStatus, number>);


  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg animate-fade-in space-y-8">
      {/* Executive Summary Section */}
      <div>
        <h2 className="text-xl font-bold text-gray-200 mb-4">2. Análise Executiva</h2>
        <div className="text-gray-300 space-y-6">
            <h3 data-export-title className="text-lg font-semibold text-blue-400">{summary.title}</h3>
            <p className="text-sm leading-relaxed">{summary.summary}</p>
            <div>
            <h4 className="flex items-center text-md font-semibold text-gray-300 mb-3"><MetricIcon className="w-5 h-5 mr-2 text-gray-400"/>Métricas Chave</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
                {summary.keyMetrics.map((item, index) => (
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
                {summary.actionableInsights.map((item, index) => (
                <li key={index}>{item}</li>
                ))}
            </ul>
            </div>
        </div>
      </div>
      
      {/* Detailed Document Analysis Section */}
      <div>
         <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Detalhes por Documento</h2>
         <div className="bg-gray-700/30 p-4 rounded-lg mb-4 flex justify-around items-center text-center">
            <div className="text-gray-300"><span className="text-2xl font-bold">{documents.length}</span><br/><span className="text-xs">Total</span></div>
            <div className="text-teal-300"><span className="text-2xl font-bold">{docStats.OK || 0}</span><br/><span className="text-xs">OK</span></div>
            <div className="text-yellow-300"><span className="text-2xl font-bold">{docStats.ALERTA || 0}</span><br/><span className="text-xs">Alertas</span></div>
            <div className="text-red-300"><span className="text-2xl font-bold">{docStats.ERRO || 0}</span><br/><span className="text-xs">Erros</span></div>
         </div>
         <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
            {documents.map((item, index) => (
                <DocumentItem key={index} item={item} />
            ))}
         </div>
      </div>
    </div>
  );
};

export default ReportViewer;
