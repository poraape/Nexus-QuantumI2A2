import React, { useState, useCallback } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import type { AuditReport, SmartSearchResult } from '../types';
import Papa from 'papaparse';
import { AiIcon, LoadingSpinnerIcon, SendIcon } from './icons';
import { logger } from '../services/logger';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const searchResponseSchema = {
    type: Type.OBJECT,
    properties: {
        summary: {
            type: Type.STRING,
            description: "Uma resposta textual concisa e direta para a pergunta do usuário."
        },
        data: {
            type: Type.ARRAY,
            nullable: true,
            description: "Opcional: Dados estruturados se a resposta puder ser representada em uma tabela.",
            items: {
                type: Type.OBJECT,
                description: "As chaves do objeto serão os cabeçalhos da tabela.",
                properties: {} // Permite chaves dinâmicas
            }
        }
    },
    required: ['summary']
};

interface SmartSearchProps {
    report: AuditReport;
}

const SmartSearch: React.FC<SmartSearchProps> = ({ report }) => {
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<SmartSearchResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        setIsLoading(true);
        setError(null);
        setResult(null);
        logger.log('SmartSearch', 'INFO', `Iniciando busca inteligente para a query: "${query}"`);

        try {
            const validDocsData = report.documents
                .filter(d => d.status !== 'ERRO' && d.doc.data)
                .flatMap(d => d.doc.data!);
            
            const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 500));
            
            const prompt = `
                Você é um assistente de análise de dados fiscais. Responda à pergunta do usuário com base EXCLUSIVAMENTE nos dados fornecidos.
                
                Métricas Agregadas (Fonte de verdade para totais):
                ${JSON.stringify(report.aggregatedMetrics, null, 2)}

                Amostra de Dados de Itens (Para perguntas detalhadas):
                ${dataSampleForAI}

                Pergunta do Usuário: "${query}"

                Sua resposta DEVE ser um único objeto JSON aderindo ao schema.
                - Forneça um 'summary' textual.
                - Se aplicável, retorne uma tabela de 'data'. As chaves do objeto se tornarão os cabeçalhos.
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: searchResponseSchema,
                },
            });
            
            const searchResult = JSON.parse(response.text) as SmartSearchResult;
            setResult(searchResult);
            logger.log('SmartSearch', 'INFO', `Busca inteligente concluída com sucesso.`);

        } catch (err) {
            console.error('Smart Search failed:', err);
            const errorMessage = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.';
            setError(`Falha na busca: ${errorMessage}`);
            logger.log('SmartSearch', 'ERROR', `Falha na busca inteligente.`, { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [query, report]);

    const tableHeaders = result?.data && result.data.length > 0 ? Object.keys(result.data[0]) : [];

    return (
        <div className="space-y-4">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ex: Qual o produto mais caro? Liste as 5 vendas de maior valor."
                    disabled={isLoading}
                    className="flex-grow bg-gray-700 rounded-full py-2 px-4 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={isLoading || !query.trim()}
                    className="bg-blue-600 hover:bg-blue-500 text-white rounded-full p-2.5 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                    {isLoading ? <LoadingSpinnerIcon className="w-5 h-5 animate-spin" /> : <SendIcon className="w-5 h-5" />}
                </button>
            </form>
            
            {error && <p className="text-sm text-red-400 text-center">{error}</p>}

            {result && (
                <div className="bg-gray-700/30 p-4 rounded-lg animate-fade-in-down space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center flex-shrink-0">
                            <AiIcon className="w-5 h-5 text-white" />
                        </div>
                        <p className="text-gray-300 flex-1 mt-1">{result.summary}</p>
                    </div>

                    {result.data && result.data.length > 0 && (
                        <div className="max-h-80 overflow-y-auto pr-2">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-400 uppercase bg-gray-800/50 sticky top-0">
                                    <tr>
                                        {tableHeaders.map(header => <th key={header} scope="col" className="px-4 py-2">{header}</th>)}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700/50">
                                    {result.data.map((row, rowIndex) => (
                                        <tr key={rowIndex} className="hover:bg-gray-600/20">
                                            {tableHeaders.map(header => (
                                                <td key={header} className="px-4 py-2 text-gray-300 font-mono">{String(row[header])}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SmartSearch;