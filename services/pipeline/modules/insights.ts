import type { ResponseSchema } from '../../geminiService';
import { PromptOptimizer } from '../promptOptimizer';
import type { CorrelationResult, CorrelatedRecord } from './correlation';
import type { HeuristicSignal } from './dataExtractor';

export interface InsightRecord<T = any> {
  id: string;
  invoiceId?: string;
  documentName: string;
  cnpjs: string[];
  taxes: number[];
  monetaryValues: number[];
  heuristics: HeuristicSignal[];
  llmResult: T;
  highlights: string[];
}

export interface InsightReport<T = any> {
  insights: InsightRecord<T>[];
  segments: ReturnType<PromptOptimizer['createSegments']>;
  heuristics: HeuristicSignal[];
}

const DEFAULT_INSIGHT_SCHEMA: ResponseSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    riskLevel: { type: 'string', enum: ['BAIXO', 'MODERADO', 'ALTO'] },
    recommendedActions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'riskLevel'],
};

export interface InsightOptions {
  model: string;
  schema?: ResponseSchema;
  baseInstruction?: string;
}

function buildRecordSummary(record: CorrelatedRecord): string {
  const invoice = record.invoiceId ? `Nota ${record.invoiceId}` : `Seção ${record.sectionId}`;
  const cnpjSummary = record.cnpjs.length > 0 ? `CNPJ(s): ${record.cnpjs.join(', ')}` : 'CNPJ não identificado';
  const taxSummary =
    record.taxes.length > 0
      ? `Alíquotas encontradas: ${record.taxes.map((value) => `${(value * 100).toFixed(2)}%`).join(', ')}`
      : 'Alíquotas não encontradas';
  const valueSummary =
    record.monetaryValues.length > 0
      ? `Valores monetários: ${record.monetaryValues.map((value) => `R$ ${value.toFixed(2)}`).join(', ')}`
      : 'Valores monetários não encontrados';

  return `${invoice} no documento ${record.documentName}. ${cnpjSummary}. ${taxSummary}. ${valueSummary}.`;
}

function buildHighlights(record: CorrelatedRecord): string[] {
  if (record.heuristics.length === 0) {
    return ['Nenhuma heurística prioritária identificada.'];
  }
  return record.heuristics
    .sort((a, b) => b.weight - a.weight)
    .map((heuristic) => `${heuristic.label}: ${heuristic.detail}`);
}

export async function generateInsights<T = any>(
  correlation: CorrelationResult,
  options: InsightOptions,
): Promise<InsightReport<T>> {
  const baseInstruction =
    options.baseInstruction ??
    'Você é um auditor fiscal especializado em contratos públicos. Analise os dados fornecidos e destaque riscos fiscais reais.';
  const schema = options.schema ?? DEFAULT_INSIGHT_SCHEMA;
  const optimizer = new PromptOptimizer(baseInstruction, correlation.heuristics);

  const sources = correlation.records.map((record) => ({
    record,
    summary: buildRecordSummary(record),
  }));

  const execution = await optimizer.executeSegments<T>(sources, options.model, schema);

  const insights: InsightRecord<T>[] = correlation.records.map((record) => ({
    id: record.id,
    invoiceId: record.invoiceId,
    documentName: record.documentName,
    cnpjs: record.cnpjs,
    taxes: record.taxes,
    monetaryValues: record.monetaryValues,
    heuristics: record.heuristics,
    llmResult: execution.outputs[record.id],
    highlights: buildHighlights(record),
  }));

  return {
    insights,
    segments: execution.segments,
    heuristics: correlation.heuristics,
  };
}
