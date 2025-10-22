import type { AuditReport, AIDrivenInsight, CrossValidationResult } from '../types';
import Papa from 'papaparse';
import { logger } from "../services/logger";
import { generateJSON, ResponseSchema } from "../services/llmService";

const intelligenceSchema: ResponseSchema = {
  type: 'object',
  properties: {
    aiDrivenInsights: {
      type: 'array',
      description: 'Anomalias, riscos ou oportunidades fiscalmente relevantes.',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['Eficiência Operacional', 'Risco Fiscal', 'Oportunidade de Otimização', 'Anomalia de Dados'] },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['INFO', 'BAIXA', 'MÉDIA', 'ALTA'] },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'description', 'severity', 'evidence'],
      },
    },
    crossValidationResults: {
      type: 'array',
      description: 'Discrepâncias entre documentos destacadas pela IA.',
      items: {
        type: 'object',
        properties: {
          attribute: { type: 'string', description: "Campo fiscal com valores conflitantes (ex: 'NCM')." },
          observation: { type: 'string', description: 'Explicação resumida da inconsistência.' },
          documents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Documento de origem.' },
                value: { type: 'string', description: 'Valor conflitante como string.' },
              },
              required: ['name', 'value'],
            },
          },
        },
        required: ['attribute', 'observation', 'documents'],
      },
    },
  },
  required: ['aiDrivenInsights', 'crossValidationResults'],
};

const sanitizeForAI = (value: any): any => {
    if (typeof value === 'string') {
        return JSON.stringify(value).slice(1, -1);
    }
    return value;
};

export const runIntelligenceAnalysis = async (
    report: Omit<AuditReport, 'summary' | 'aiDrivenInsights' | 'crossValidationResults'>
): Promise<Pick<AuditReport, 'aiDrivenInsights' | 'crossValidationResults'>> => {

    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data);
    if (validDocs.length < 2) {
        logger.log('IntelligenceAgent', 'INFO', 'Análise de IA pulada: menos de 2 documentos válidos para comparação.');
        return { aiDrivenInsights: [], crossValidationResults: [] };
    }

    const allItems = validDocs.flatMap(d => {
        const docName = d.doc.name;
        return d.doc.data!.map(item => ({ ...item, doc_source: docName }));
    });

    const sanitizedItems = allItems.map(item => {
        const newItem: Record<string, any> = {};
        for (const key in item) {
            newItem[key] = sanitizeForAI((item as any)[key]);
        }
        return newItem;
    });

    const dataSampleForAI = Papa.unparse(sanitizedItems.slice(0, 500));

    const deterministicFindings = report.documents
        .flatMap(d => d.inconsistencies.map(inc => ({ document: d.doc.name, message: inc.message, severity: inc.severity })))
        .slice(0, 30);

    const prompt = `
        Você é um auditor fiscal sênior com IA. Sua tarefa é realizar uma análise profunda em um conjunto de dados fiscais extraídos de várias notas fiscais.

        Já realizei uma auditoria baseada em regras e encontrei estas inconsistências de ALTA PRIORIDADE:
        ---
        Resultados da Auditoria Determinística (Amostra Prioritária):
        ${JSON.stringify(deterministicFindings, null, 2)}
        ---

        Aqui está uma amostra dos dados de itens de todas as notas fiscais (em formato CSV):
        ---
        Amostra de Dados:
        ${dataSampleForAI}
        ---

        Suas tarefas são:
        1.  **aiDrivenInsights:** Analise os dados para encontrar padrões, anomalias e oportunidades que as regras não pegam.
        2.  **crossValidationResults:** Compare os itens entre si (inter-documentos) e liste as discrepâncias mais significativas.

        Responda em Português do Brasil. Sua resposta DEVE ser um único objeto JSON que adere ao schema fornecido. Não inclua texto fora do objeto JSON.
    `;

    try {
        const result = await generateJSON<{
            aiDrivenInsights: AIDrivenInsight[],
            crossValidationResults: CrossValidationResult[]
        }>(
            'gemini-2.0-flash',
            prompt,
            intelligenceSchema,
            'intelligence-analysis'
        );

        return result;

    } catch (e) {
        logger.log('IntelligenceAgent', 'ERROR', 'Falha ao executar análise de inteligência com IA.', { error: e });
        console.error("AI Intelligence Agent failed:", e);
        return { aiDrivenInsights: [], crossValidationResults: [] };
    }
};
