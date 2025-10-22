import React from 'react';
import { parseSafeFloat } from '../../utils/parsingUtils';

interface TotalSummaryProps {
    metrics?: Record<string, unknown>;
}

const safeNumber = (value: unknown): number => {
    if (typeof value === 'number') {
        return Number.isNaN(value) ? 0 : value;
    }
    return parseSafeFloat(value);
};

const TotalSummary: React.FC<TotalSummaryProps> = ({ metrics }) => {
    if (!metrics) {
        return null;
    }

    const totalNfe = safeNumber(metrics['Valor Total das NFes']);
    const totalProducts = safeNumber(metrics['Valor Total dos Produtos']);
    const totalTaxes = safeNumber(metrics['Valor Total de ICMS']);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-700/50 p-4 rounded-lg shadow">
                <p className="text-xs uppercase text-gray-400">Valor Total das NFes</p>
                <p className="text-2xl font-bold text-blue-300">
                    {totalNfe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
            </div>
            <div className="bg-gray-700/50 p-4 rounded-lg shadow">
                <p className="text-xs uppercase text-gray-400">Valor Total dos Produtos</p>
                <p className="text-2xl font-bold text-emerald-300">
                    {totalProducts.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
            </div>
            <div className="bg-gray-700/50 p-4 rounded-lg shadow">
                <p className="text-xs uppercase text-gray-400">Valor Total de ICMS</p>
                <p className="text-2xl font-bold text-teal-300">
                    {totalTaxes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
            </div>
        </div>
    );
};

export default TotalSummary;
