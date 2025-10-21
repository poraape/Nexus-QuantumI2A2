import React, { useMemo, useState } from 'react';
import type { AuditReport, ChartData } from '../types';
import Chart from './Chart';
import CrossValidationPanel from './CrossValidationPanel';
import SmartSearch from './SmartSearch';
import { parseSafeFloat } from '../utils/parsingUtils';

interface DashboardProps {
    report: AuditReport;
}

interface MemoizedDashboardData {
    cfopChart: ChartData;
    ncmChart: ChartData;
    ufChart: ChartData;
    totalValue: number;
}

const Dashboard: React.FC<DashboardProps> = ({ report }) => {
    const [simAliquot, setSimAliquot] = useState(18);

    const dashboardData = useMemo((): MemoizedDashboardData => {
        const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data);
        const allItems = validDocs.flatMap(d => d.doc.data!);

        const cfopData = allItems.reduce((acc, item) => {
            const cfop = item.produto_cfop?.toString() || 'N/A';
            acc[cfop] = (acc[cfop] || 0) + (parseSafeFloat(item.produto_valor_total));
            return acc;
        }, {} as Record<string, number>);

        const ncmData = allItems.reduce((acc, item) => {
            const ncm = item.produto_ncm?.toString() || 'N/A';
            acc[ncm] = (acc[ncm] || 0) + (parseSafeFloat(item.produto_valor_total));
            return acc;
        }, {} as Record<string, number>);

        const ufData = validDocs.reduce((acc, auditedDoc) => {
            if (auditedDoc.doc.data && auditedDoc.doc.data.length > 0) {
                const uf = auditedDoc.doc.data[0].destinatario_uf || 'N/A';
                acc[uf] = (acc[uf] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);
        
        const totalValue = parseSafeFloat(report.aggregatedMetrics?.['Valor Total das NFes']);
            
        return {
            cfopChart: {
                type: 'bar',
                title: 'Valor por CFOP',
                data: Object.entries(cfopData).slice(0, 10).map(([label, value]) => ({ label, value })),
                yAxisLabel: 'Valor (R$)',
            },
            ncmChart: {
                type: 'pie',
                title: 'Distribuição por NCM (Top 5)',
                data: Object.entries(ncmData).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value })),
            },
            ufChart: {
                type: 'bar',
                title: 'Documentos por UF de Destino',
                data: Object.entries(ufData).map(([label, value]) => ({ label, value })),
                yAxisLabel: 'Qtd. Documentos',
            },
            totalValue
        };
    }, [report]);
    
    const simulatedIcms = (dashboardData.totalValue * (simAliquot / 100));

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg animate-fade-in space-y-8">
            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4">Dashboard Interativo</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                   <div className="bg-gray-700/50 p-4 rounded-md" data-chart-container="true">
                        <Chart {...dashboardData.cfopChart} />
                   </div>
                   <div className="bg-gray-700/50 p-4 rounded-md" data-chart-container="true">
                        <Chart {...dashboardData.ncmChart} />
                   </div>
                   <div className="bg-gray-700/50 p-4 rounded-md" data-chart-container="true">
                        <Chart {...dashboardData.ufChart} />
                   </div>
                </div>
            </div>

            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Simulação Preditiva (What-if)</h2>
                <div className="bg-gray-700/30 p-4 rounded-lg flex flex-col md:flex-row gap-6 items-center">
                    <div className="flex-1 w-full">
                        <label htmlFor="aliquota" className="block text-sm font-medium text-gray-300 mb-2">
                            Alíquota de ICMS Simulado (%)
                        </label>
                        <input
                            type="range"
                            id="aliquota"
                            min="0"
                            max="30"
                            step="0.5"
                            value={simAliquot}
                            onChange={(e) => setSimAliquot(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        />
                         <div className="text-center text-lg font-bold text-blue-400 mt-2">{simAliquot.toFixed(1)}%</div>
                    </div>
                    <div className="flex-1 text-center md:text-left">
                        <p className="text-sm text-gray-400">Valor Total das NF-es:</p>
                        <p className="text-2xl font-bold text-gray-200 mb-2">
                            {dashboardData.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                        <p className="text-sm text-gray-400">Valor de ICMS Simulado:</p>
                        <p className="text-2xl font-bold text-teal-400">
                             {simulatedIcms.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                    </div>
                </div>
                 <p className="text-xs text-gray-500 mt-2 text-center">
                    Nota: A simulação é uma estimativa baseada no valor total dos documentos e não considera isenções, reduções ou substituição tributária.
                </p>
            </div>
            
            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Busca Inteligente com IA</h2>
                 <SmartSearch report={report} />
            </div>

            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Validação Cruzada Interdocumental (IA)</h2>
                <p className="text-xs text-gray-500 mb-4">
                    A IA compara atributos fiscais e valores entre todos os itens para encontrar inconsistências sutis ou padrões que merecem atenção.
                </p>
                <CrossValidationPanel results={report.crossValidationResults} />
            </div>
        </div>
    );
};

export default Dashboard;