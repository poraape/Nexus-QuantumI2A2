import React from 'react';
import type { DeterministicCrossValidationResult } from '../types';
import { ShieldExclamationIcon, FileIcon } from './icons';

interface AnalysisDisplayProps {
  results: DeterministicCrossValidationResult[] | undefined;
}

const severityStyles: Record<DeterministicCrossValidationResult['severity'], string> = {
    ALERTA: 'border-l-yellow-500',
    INFO: 'border-l-sky-500',
};

const AnalysisDisplay: React.FC<AnalysisDisplayProps> = ({ results }) => {
  if (!results || results.length === 0) {
    return (
      <div className="bg-gray-700/30 p-4 rounded-lg text-center">
        <p className="text-sm text-teal-400">✅ Nenhuma inconsistência material foi encontrada pela validação cruzada determinística.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-700/30 p-4 rounded-lg space-y-4">
        <div className="max-h-96 overflow-y-auto pr-2">
            {results.map((result, index) => (
                <div key={index} className={`bg-gray-800/50 p-4 rounded-lg border-l-4 mb-3 ${severityStyles[result.severity]}`}>
                    <div className="flex justify-between items-start gap-4">
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="bg-gray-700/70 text-blue-300 font-bold uppercase tracking-wide px-2 py-0.5 rounded">{result.ruleCode}</span>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-md bg-gray-700/70`}>{result.severity}</span>
                            </div>
                            <p className="font-semibold text-gray-200">{result.attribute}: <span className="font-normal text-gray-400">"{result.comparisonKey}"</span></p>
                            <p className="text-sm text-yellow-300">{result.description}</p>
                            <p className="text-xs text-gray-500">
                                Contexto: NCM {result.context.ncm} • CFOP {result.context.cfop} • {result.context.dataEmissao ? `Data ${result.context.dataEmissao}` : 'Data não informada'}
                            </p>
                            {(result.context.emitenteCnpj || result.context.destinatarioCnpj) && (
                                <p className="text-xs text-gray-500">
                                    CNPJs correlacionados: {[result.context.emitenteCnpj, result.context.destinatarioCnpj].filter(Boolean).join(' ↔ ')}
                                </p>
                            )}
                            <p className="text-xs text-gray-400">Justificativa: {result.justification}</p>
                        </div>
                    </div>

                    <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-500 mb-2">Evidências:</h4>
                        {result.discrepancies.map((d, i) => (
                             <div key={i} className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-gray-700/50 pt-2 mt-2">
                                <div className="flex items-center gap-2 truncate">
                                    <FileIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <span className="truncate text-gray-400" title={d.docA.name}>{d.docA.name}</span>
                                </div>
                                <p className="font-mono text-orange-300">{d.valueA}</p>
                                <div className="flex items-center gap-2 truncate">
                                    <FileIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <span className="truncate text-gray-400" title={d.docB.name}>{d.docB.name}</span>
                                </div>
                                <p className="font-mono text-yellow-300">{d.valueB}</p>
                                <p className="col-span-2 text-[11px] text-gray-500">{d.ruleCode} • {d.justification}</p>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};

export default AnalysisDisplay;
