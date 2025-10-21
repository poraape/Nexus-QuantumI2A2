import { Type } from "@google/genai";
import type { AnalysisResult, AuditReport, AccountingEntry, AuditedDocument, SpedFile } from '../types';
import { logger } from "../services/logger";
import { parseSafeFloat } from "../utils/parsingUtils";
import { generateJSON } from "../services/geminiService";

const analysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    keyMetrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          metric: { type: Type.STRING },
          value: { type: Type.STRING },
          insight: { type: Type.STRING },
        },
        required: ['metric', 'value', 'insight'],
      },
    },
    actionableInsights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    strategicRecommendations: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Recomendações estratégicas de alto nível para o negócio.'
    }
  },
  required: ['title', 'summary', 'keyMetrics', 'actionableInsights', 'strategicRecommendations'],
};

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Alíquotas simplificadas para cálculo
const MOCK_ALIQUOTAS = {
    ISS: 0.05, // 5%
    IVA: 0.25, // 25% (simulado)
};


/**
 * Runs deterministic aggregations on the report data, ensuring a consistent object shape is always returned.
 */
const runDeterministicAccounting = (report: Omit<AuditReport, 'summary'>): Record<string, any> => {
    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data && d.doc.data.length > 0);

    const defaultMetrics = {
        'Número de Documentos Válidos': 0,
        'Valor Total das NFes': formatCurrency(0),
        'Valor Total dos Produtos': formatCurrency(0),
        'Total de Itens Processados': 0,
        'Valor Total de ICMS': formatCurrency(0),
        'Valor Total de PIS': formatCurrency(0),
        'Valor Total de COFINS': formatCurrency(0),
        'Valor Total de ISS': formatCurrency(0),
        'Estimativa de IVA (Simulado)': formatCurrency(0),
    };

    if (validDocs.length === 0) {
        return defaultMetrics;
    }

    const allItems = validDocs.flatMap(d => d.doc.data!);
    
    // **BUG FIX:** Correctly aggregate total NFe value by using a Map on unique documents, not all items.
    const uniqueNfes = new Map<string, number>();
    validDocs.forEach(doc => {
        // Assume the first item holds the NFe-level data, which is how normalizeNFeData works.
        const firstItem = doc.doc.data?.[0];
        if (firstItem?.nfe_id) {
            uniqueNfes.set(firstItem.nfe_id, parseSafeFloat(firstItem.valor_total_nfe));
        }
    });
    
    let totalNfeValue = Array.from(uniqueNfes.values()).reduce((sum, val) => sum + val, 0);
    
    const totals = allItems.reduce((acc, item) => {
        const itemValue = parseSafeFloat(item.produto_valor_total);
        acc.totalProductValue += itemValue;
        acc.totalICMS += parseSafeFloat(item.produto_valor_icms);
        acc.totalPIS += parseSafeFloat(item.produto_valor_pis);
        acc.totalCOFINS += parseSafeFloat(item.produto_valor_cofins);

        // Simple check for service items to calculate ISS
        if (item.produto_cfop?.toString().endsWith('933')) {
            acc.totalISS += itemValue * MOCK_ALIQUOTAS.ISS;
        }

        return acc;
    }, { totalProductValue: 0, totalICMS: 0, totalPIS: 0, totalCOFINS: 0, totalISS: 0 });

    let qualityWarning = null;
    // Fallback: If NFe ID aggregation failed but there are products, use product sum as an approximation.
    if (totalNfeValue === 0 && totals.totalProductValue > 0) {
        logger.log('AccountantAgent', 'WARN', 'A agregação por NFe ID resultou em zero. Usando a soma dos valores de produtos como fallback para o valor total. O valor pode ser impreciso se houver NFes duplicadas.');
        totalNfeValue = totals.totalProductValue + totals.totalICMS; // Simplified sum
        qualityWarning = 'Atenção: Valor total das NFes foi inferido a partir da soma dos produtos. Verifique se os campos de ID e valor total da NFe estão presentes e corretos nos documentos originais.';
    }

    const totalIVA = (totals.totalPIS + totals.totalCOFINS) * MOCK_ALIQUOTAS.IVA;

    const metrics: Record<string, string | number> = {
        'Número de Documentos Válidos': validDocs.length,
        'Valor Total das NFes': formatCurrency(totalNfeValue),
        'Valor Total dos Produtos': formatCurrency(totals.totalProductValue),
        'Total de Itens Processados': allItems.length,
        'Valor Total de ICMS': formatCurrency(totals.totalICMS),
        'Valor Total de PIS': formatCurrency(totals.totalPIS),
        'Valor Total de COFINS': formatCurrency(totals.totalCOFINS),
        'Valor Total de ISS': formatCurrency(totals.totalISS),
        'Estimativa de IVA (Simulado)': formatCurrency(totalIVA),
    };
    
    if (qualityWarning) {
        metrics['Qualidade dos Dados'] = qualityWarning;
    }
    
    if (totalNfeValue === 0 && allItems.length > 0) {
        metrics['Alerta de Qualidade'] = 'O valor total das NFes processadas é zero. Isso é altamente incomum e pode indicar problemas nos dados de origem. Verifique os valores `vNF` nos arquivos XML.';
    }

    return metrics;
}

const runAIAccountingSummary = async (dataSample: string, aggregatedMetrics: Record<string, any>): Promise<AnalysisResult> => {
  const dataQualityIssue = aggregatedMetrics['Alerta de Qualidade'] || aggregatedMetrics['Qualidade dos Dados'];

  const prompt = `
        You are an expert financial analyst. I have performed a preliminary, deterministic analysis on a batch of fiscal documents and derived the following key aggregated metrics:
        ---
        Aggregated Metrics:
        ${JSON.stringify(aggregatedMetrics, null, 2)}
        ---
        ${dataQualityIssue ? `\n**ALERTA CRÍTICO DE QUALIDADE DE DADOS:** ${dataQualityIssue}\n` : ''}
        I also have a small, representative sample of the line-item data from these documents in CSV format:
        ---
        Data Sample:
        ${dataSample}
        ---

        Your task is to act as the final step in the analysis pipeline.
        1.  Create a compelling, professional 'title' for this analysis report.
        2.  Write a concise 'summary' of the fiscal situation based on both the aggregated metrics and the data sample.
        3.  Populate the 'keyMetrics' array. You MUST use the pre-calculated aggregated metrics as the primary source of truth. You can add 1-2 additional metrics if you can derive them reliably from the data sample (e.g., Top Product by Value).
        4.  Generate 2-3 insightful, 'actionableInsights' for a business manager. ${dataQualityIssue ? "Você DEVE incluir um insight abordando diretamente o alerta de qualidade de dados." : ""}
        5.  Based on everything, provide 1-2 'strategicRecommendations' for the business. These should be higher-level than the actionable insights, focusing on long-term strategy (e.g., "Consider reviewing the supply chain for product X due to price volatility," or "Evaluate the tax regime for service-based revenue.").

        The entire response must be in Brazilian Portuguese and formatted as a single JSON object adhering to the required schema. Do not include any text outside of the JSON object.
    `;
  
  return generateJSON<AnalysisResult>(
    'gemini-2.5-flash',
    prompt,
    analysisResponseSchema
  );
};

const generateAccountingEntries = (documents: AuditedDocument[]): AccountingEntry[] => {
    const entries: AccountingEntry[] = [];
    
    for (const doc of documents) {
        if (doc.status === 'ERRO' || !doc.classification || !doc.doc.data || doc.doc.data.length === 0) continue;
        
        const totalNfe = parseSafeFloat(doc.doc.data[0]?.valor_total_nfe);
        const totalProducts = doc.doc.data.reduce((sum, item) => sum + parseSafeFloat(item.produto_valor_total), 0);
        const totalIcms = doc.doc.data.reduce((sum, item) => sum + parseSafeFloat(item.produto_valor_icms), 0);
        
        if (totalNfe === 0 && totalProducts === 0) continue; // Skip docs with no values

        switch (doc.classification.operationType) {
            case 'Compra':
                entries.push({ docName: doc.doc.name, account: '1.1.2 Estoques', type: 'D', value: totalProducts });
                if (totalIcms > 0) {
                    entries.push({ docName: doc.doc.name, account: '1.2.1 ICMS a Recuperar', type: 'D', value: totalIcms });
                }
                entries.push({ docName: doc.doc.name, account: '2.1.1 Fornecedores', type: 'C', value: totalNfe });
                break;
            case 'Venda':
                entries.push({ docName: doc.doc.name, account: '1.1.3 Clientes', type: 'D', value: totalNfe });
                entries.push({ docName: doc.doc.name, account: '4.1.1 Receita de Vendas', type: 'C', value: totalProducts });
                if (totalIcms > 0) {
                     entries.push({ docName: doc.doc.name, account: '4.2.1 ICMS sobre Vendas', type: 'D', value: totalIcms });
                     entries.push({ docName: doc.doc.name, account: '2.1.2 ICMS a Recolher', type: 'C', value: totalIcms });
                }
                break;
            case 'Devolução':
                const firstCfopDev = doc.doc.data[0]?.produto_cfop?.toString();
                if (firstCfopDev?.startsWith('1') || firstCfopDev?.startsWith('2')) { // Devolução de Compra
                    entries.push({ docName: doc.doc.name, account: '2.1.1 Fornecedores', type: 'D', value: totalNfe });
                    if (totalIcms > 0) {
                        entries.push({ docName: doc.doc.name, account: '1.2.1 ICMS a Recuperar', type: 'C', value: totalIcms });
                    }
                    entries.push({ docName: doc.doc.name, account: '1.1.2 Estoques', type: 'C', value: totalProducts });
                } else if (firstCfopDev?.startsWith('5') || firstCfopDev?.startsWith('6')) { // Devolução de Venda
                    entries.push({ docName: doc.doc.name, account: '4.1.2 Devoluções de Vendas', type: 'D', value: totalProducts });
                    if (totalIcms > 0) {
                        // This should be a debit to reduce liability, but accounting can be complex.
                        // For simplicity, we debit the tax liability account.
                        entries.push({ docName: doc.doc.name, account: '2.1.2 ICMS a Recolher', type: 'D', value: totalIcms });
                    }
                    entries.push({ docName: doc.doc.name, account: '1.1.3 Clientes', type: 'C', value: totalNfe });
                }
                break;
            case 'Serviço':
                const firstCfopServ = doc.doc.data[0]?.produto_cfop?.toString();
                 if (firstCfopServ?.startsWith('5') || firstCfopServ?.startsWith('6') || firstCfopServ?.startsWith('7')) { // Serviço Prestado
                    entries.push({ docName: doc.doc.name, account: '1.1.3 Clientes', type: 'D', value: totalNfe });
                    entries.push({ docName: doc.doc.name, account: '4.1.3 Receita de Serviços', type: 'C', value: totalNfe });
                } else { // Serviço Tomado (compra)
                    entries.push({ docName: doc.doc.name, account: '3.1.1 Despesa com Serviços', type: 'D', value: totalNfe });
                    entries.push({ docName: doc.doc.name, account: '2.1.1 Fornecedores', type: 'C', value: totalNfe });
                }
                break;
            case 'Transferência':
                const firstCfopTransf = doc.doc.data[0]?.produto_cfop?.toString();
                if (firstCfopTransf?.startsWith('5') || firstCfopTransf?.startsWith('6')) { // Transferência de saída
                    entries.push({ docName: doc.doc.name, account: '3.1.2 Custo de Transferência', type: 'D', value: totalProducts });
                    entries.push({ docName: doc.doc.name, account: '1.1.2 Estoques', type: 'C', value: totalProducts });
                } else { // Transferência de entrada
                    entries.push({ docName: doc.doc.name, account: '1.1.2 Estoques', type: 'D', value: totalProducts });
                    entries.push({ docName: doc.doc.name, account: '4.1.4 Receita de Transferência', type: 'C', value: totalProducts });
                }
                break;
        }
    }
    return entries;
};

const generateSpedEfd = (report: Pick<AuditReport, 'documents'>): SpedFile => {
    const lines: string[] = [];
    const today = new Date();
    const dataIni = new Date(today.getFullYear(), today.getMonth(), 1).toLocaleDateString('pt-BR').replace(/\//g, '');
    const dataFim = new Date(today.getFullYear(), today.getMonth() + 1, 0).toLocaleDateString('pt-BR').replace(/\//g, '');

    const recordCounts: Record<string, number> = {};
    const countRecord = (type: string) => { recordCounts[type] = (recordCounts[type] || 0) + 1; };

    // Bloco 0
    lines.push(`|0000|017|0|${dataIni}|${dataFim}|Nexus QuantumI2A2|12345678000195||SP|||A|1|`);
    countRecord('0000');
    lines.push('|0001|0|');
    countRecord('0001');

    // Bloco C
    lines.push('|C001|0|');
    countRecord('C001');
    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data && d.doc.data.length > 0);
    
    for(const doc of validDocs) {
        const firstItem = doc.doc.data![0];
        lines.push(`|C100|${doc.classification?.operationType === 'Compra' ? '0' : '1'}|0||55|||${parseSafeFloat(firstItem.valor_total_nfe).toFixed(2).replace('.',',')}||||||||`);
        countRecord('C100');

        const c190Aggregator: Record<string, { vBC: number, vIcms: number, vOper: number }> = {};
        
        doc.doc.data?.forEach((item) => {
            const cst = (item.produto_cst_icms?.toString() || '00').slice(0, 3);
            const cfop = item.produto_cfop?.toString() || '0000';
            const aliq = (item.produto_aliquota_icms || 0).toFixed(2).replace('.',',');
            const key = `${cst}|${cfop}|${aliq}`;

            if (!c190Aggregator[key]) {
                c190Aggregator[key] = { vBC: 0, vIcms: 0, vOper: 0 };
            }
            c190Aggregator[key].vBC += parseSafeFloat(item.produto_base_calculo_icms);
            c190Aggregator[key].vIcms += parseSafeFloat(item.produto_valor_icms);
            c190Aggregator[key].vOper += parseSafeFloat(item.produto_valor_total);
        });

        Object.entries(c190Aggregator).forEach(([key, values]) => {
            const [cst, cfop, aliq] = key.split('|');
            lines.push(`|C190|${cst}|${cfop}|${aliq}|${values.vOper.toFixed(2).replace('.',',')}|${values.vBC.toFixed(2).replace('.',',')}|${values.vIcms.toFixed(2).replace('.',',')}||||`);
            countRecord('C190');
        });
        
        doc.doc.data?.forEach((item, index) => {
            lines.push(`|C170|${index+1}|${item.produto_nome || ''}|${parseSafeFloat(item.produto_qtd).toFixed(2).replace('.',',')}|UN|${parseSafeFloat(item.produto_valor_total).toFixed(2).replace('.',',')}||${item.produto_cfop}|${item.produto_cst_icms}||||`);
            countRecord('C170');
        });
    }
    
    lines.push(`|C990|${1 + (recordCounts['C100'] || 0) + (recordCounts['C170'] || 0) + (recordCounts['C190'] || 0) + 1}|`);
    countRecord('C990');
    
    // Bloco 9
    lines.push('|9001|0|');
    countRecord('9001');

    lines.push('|0990|2|');
    countRecord('0990');
    
    const finalRecordCounts = { ...recordCounts };
    finalRecordCounts['9990'] = 1; // Self-reference for 9990
    finalRecordCounts['9999'] = 1; // Self-reference for 9999
    
    const sortedRecords = Object.keys(finalRecordCounts).sort();
    sortedRecords.forEach(rec => {
        lines.push(`|9900|${rec}|${finalRecordCounts[rec]}|`);
        countRecord('9900');
    });

    lines.push(`|9990|${(recordCounts['9001'] || 0) + (recordCounts['9900'] || 0) + 1}|`);
    countRecord('9990');

    const totalLines = lines.length + 1;
    lines.push(`|9999|${totalLines}|`);

    return {
        filename: `SPED-EFD-${today.toISOString().split('T')[0]}.txt`,
        content: lines.join('\n')
    };
};

export const runAccountingAnalysis = async (report: Omit<AuditReport, 'summary'>): Promise<AuditReport> => {
    // 1. Run deterministic calculations first
    const aggregatedMetrics = runDeterministicAccounting(report);

    // 2. Generate Accounting Entries
    const accountingEntries = generateAccountingEntries(report.documents);
    
    // 3. Generate SPED File
    const spedFile = generateSpedEfd(report);

    const validDocsData = report.documents
        .filter(d => d.status !== 'ERRO' && d.doc.data)
        .flatMap(d => d.doc.data!);
    
    if (validDocsData.length === 0) {
        // Return a default summary if no valid data is available
        const defaultSummary: AnalysisResult = {
            title: "Análise Fiscal Concluída",
            summary: "Não foram encontrados dados válidos para gerar um resumo detalhado. Verifique os documentos com erro.",
            keyMetrics: Object.entries(aggregatedMetrics).map(([key, value]) => ({ metric: key, value: String(value), insight: "" })),
            actionableInsights: ["Verificar a causa dos erros nos documentos importados para permitir uma análise completa."],
            strategicRecommendations: ["Implementar um processo de validação de arquivos na origem para garantir a qualidade dos dados para análise."]
        };
         return { ...report, summary: defaultSummary, aggregatedMetrics, accountingEntries, spedFile };
    }
    
    const { default: Papa } = await import('papaparse');
    const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));

    // 4. Run AI analysis with deterministic data as context
    const summary = await runAIAccountingSummary(dataSampleForAI, aggregatedMetrics);

    // 5. Combine results
    return { ...report, summary, aggregatedMetrics, accountingEntries, spedFile };
};
