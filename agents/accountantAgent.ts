import { GoogleGenAI, Type } from "@google/genai";
import type { AnalysisResult, AuditReport, AccountingEntry, AuditedDocument, SpedFile } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
  },
  required: ['title', 'summary', 'keyMetrics', 'actionableInsights'],
};

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Alíquotas simplificadas para cálculo
const MOCK_ALIQUOTAS = {
    ISS: 0.05, // 5%
    IVA: 0.25, // 25% (simulado)
};

/**
 * Runs deterministic aggregations on the report data.
 */
const runDeterministicAccounting = (report: Omit<AuditReport, 'summary'>): Record<string, any> => {
    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data);
    if (validDocs.length === 0) return {};

    const allItems = validDocs.flatMap(d => d.doc.data!);
    
    const uniqueNfeValues = new Map<string, number>();
    allItems.forEach(item => {
        const key = `${item.emitente_nome}-${item.valor_total_nfe}-${item.data_emissao}`;
        uniqueNfeValues.set(key, parseFloat(item.valor_total_nfe || 0));
    });
    
    const totalNfeValue = Array.from(uniqueNfeValues.values()).reduce((sum, val) => sum + val, 0);
    
    const totals = allItems.reduce((acc, item) => {
        const itemValue = parseFloat(item.produto_valor_total || 0);
        acc.totalProductValue += itemValue;
        acc.totalICMS += parseFloat(item.produto_valor_icms || 0);
        acc.totalPIS += parseFloat(item.produto_valor_pis || 0);
        acc.totalCOFINS += parseFloat(item.produto_valor_cofins || 0);

        // Simple check for service items to calculate ISS
        if (item.produto_cfop?.toString().endsWith('933')) {
            acc.totalISS += itemValue * MOCK_ALIQUOTAS.ISS;
        }

        return acc;
    }, { totalProductValue: 0, totalICMS: 0, totalPIS: 0, totalCOFINS: 0, totalISS: 0 });

    const totalIVA = (totals.totalPIS + totals.totalCOFINS) * MOCK_ALIQUOTAS.IVA; // Simplified IVA calculation for demo

    const metrics: Record<string, string | number> = {
        'Número de Documentos Válidos': validDocs.length,
        'Valor Total das NFes': formatCurrency(totalNfeValue),
        'Valor Total dos Produtos': formatCurrency(totals.totalProductValue),
        'Total de Itens Processados': allItems.length,
    };
    
    if (totals.totalICMS > 0) metrics['Valor Total de ICMS'] = formatCurrency(totals.totalICMS);
    if (totals.totalPIS > 0) metrics['Valor Total de PIS'] = formatCurrency(totals.totalPIS);
    if (totals.totalCOFINS > 0) metrics['Valor Total de COFINS'] = formatCurrency(totals.totalCOFINS);
    if (totals.totalISS > 0) metrics['Valor Total de ISS'] = formatCurrency(totals.totalISS);
    if (totalIVA > 0) metrics['Estimativa de IVA (Simulado)'] = formatCurrency(totalIVA);
    
    return metrics;
}

const runAIAccountingSummary = async (dataSample: string, aggregatedMetrics: Record<string, any>): Promise<AnalysisResult> => {
  const prompt = `
        You are an expert financial analyst. I have performed a preliminary, deterministic analysis on a batch of fiscal documents and derived the following key aggregated metrics:
        ---
        Aggregated Metrics:
        ${JSON.stringify(aggregatedMetrics, null, 2)}
        ---

        I also have a small, representative sample of the line-item data from these documents in CSV format:
        ---
        Data Sample:
        ${dataSample}
        ---

        Your task is to act as the final step in the analysis pipeline.
        1.  Create a compelling, professional 'title' for this analysis report.
        2.  Write a concise 'summary' of the fiscal situation based on both the aggregated metrics and the data sample.
        3.  Populate the 'keyMetrics' array. You MUST use the pre-calculated aggregated metrics as the primary source of truth. You can add 1-2 additional metrics if you can derive them reliably from the data sample (e.g., Top Product by Value).
        4.  Generate 2-3 insightful, 'actionableInsights' for a business manager.

        The entire response must be in Brazilian Portuguese and formatted as a single JSON object adhering to the required schema. Do not include any text outside of the JSON object.
    `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: analysisResponseSchema,
    },
  });

  try {
    return JSON.parse(response.text) as AnalysisResult;
  } catch (e) {
    console.error('Failed to parse analysis JSON:', response.text);
    throw new Error('A resposta da IA não estava em um formato JSON válido.');
  }
};

const generateAccountingEntries = (documents: AuditedDocument[]): AccountingEntry[] => {
    const entries: AccountingEntry[] = [];
    
    for (const doc of documents) {
        if (doc.status === 'ERRO' || !doc.classification || !doc.doc.data) continue;
        
        const totalNfe = parseFloat(doc.doc.data[0]?.valor_total_nfe || 0);
        const totalProducts = doc.doc.data.reduce((sum, item) => sum + parseFloat(item.produto_valor_total || 0), 0);
        const totalIcms = doc.doc.data.reduce((sum, item) => sum + parseFloat(item.produto_valor_icms || 0), 0);
        
        if (totalNfe === 0 || totalProducts === 0) continue;

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
            // Simplified: No entries for other types for now
        }
    }
    return entries;
};

// FIX: Update function signature to only depend on `documents`, which is available when it's called.
const generateSpedEfd = (report: Pick<AuditReport, 'documents'>): SpedFile => {
    const lines: string[] = [];
    const today = new Date();
    const dataIni = new Date(today.getFullYear(), today.getMonth(), 1).toLocaleDateString('pt-BR').replace(/\//g, '');
    const dataFim = new Date(today.getFullYear(), today.getMonth() + 1, 0).toLocaleDateString('pt-BR').replace(/\//g, '');

    // Bloco 0
    lines.push(`|0000|017|0|${dataIni}|${dataFim}|Nexus QuantumI2A2|12345678000195||SP|||A|1|`);
    lines.push('|0001|0|');
    lines.push('|0990|2|');

    // Bloco C
    lines.push('|C001|0|');
    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data);
    
    for(const doc of validDocs) {
        const firstItem = doc.doc.data![0];
        lines.push(`|C100|${doc.classification?.operationType === 'Compra' ? '0' : '1'}|0||55|||${parseFloat(firstItem.valor_total_nfe).toFixed(2).replace('.',',')}||||||||`);
        
        doc.doc.data?.forEach((item, index) => {
            lines.push(`|C170|${index+1}|${item.produto_nome}|${parseFloat(item.produto_qtd).toFixed(2).replace('.',',')}|UN|${parseFloat(item.produto_valor_total).toFixed(2).replace('.',',')}||${item.produto_cfop}|${item.produto_cst_icms}||||`);
        });
    }
    lines.push(`|C990|${lines.length - 2}|`); // count lines in block C

    // Bloco 9
    lines.push('|9001|0|');
    lines.push('|9900|0000|1|');
    lines.push('|9900|0001|1|');
    lines.push('|9900|0990|1|');
    lines.push('|9900|C001|1|');
    lines.push(`|9900|C100|${validDocs.length}|`);
    lines.push(`|9900|C170|${validDocs.flatMap(d => d.doc.data!).length}|`);
    lines.push('|9900|C990|1|');
    lines.push('|9900|9001|1|');
    lines.push('|9990|10|'); // total lines in block 9

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
    const spedFile = generateSpedEfd({ ...report, aggregatedMetrics, accountingEntries });

    const validDocsData = report.documents
        .filter(d => d.status !== 'ERRO' && d.doc.data)
        .flatMap(d => d.doc.data!);
    
    if (validDocsData.length === 0) {
        // Return a default summary if no valid data is available
        const defaultSummary: AnalysisResult = {
            title: "Análise Fiscal Concluída",
            summary: "Não foram encontrados dados válidos para gerar um resumo detalhado. Verifique os documentos com erro.",
            keyMetrics: Object.entries(aggregatedMetrics).map(([key, value]) => ({ metric: key, value: String(value), insight: "" })),
            actionableInsights: ["Verificar a causa dos erros nos documentos importados para permitir uma análise completa."]
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
