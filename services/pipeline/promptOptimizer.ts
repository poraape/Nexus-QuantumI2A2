import { generateJSON, type ResponseSchema } from '../geminiService';
import type { HeuristicSignal } from './modules/dataExtractor';
import type { CorrelatedRecord } from './modules/correlation';

export interface PromptSegment {
  id: string;
  prompt: string;
  contextKey: string;
  weight: number;
}

interface SegmentSource {
  record: CorrelatedRecord;
  summary: string;
}

export interface PromptExecutionResult<T> {
  outputs: Record<string, T>;
  segments: PromptSegment[];
}

export class PromptOptimizer {
  constructor(private baseInstruction: string, private globalHeuristics: HeuristicSignal[] = []) {}

  private composeHeuristicSummary(heuristics: HeuristicSignal[]): string {
    if (heuristics.length === 0) {
      return 'Nenhum sinal heurístico relevante encontrado.';
    }

    const ordered = [...heuristics].sort((a, b) => b.weight - a.weight);
    return ordered
      .slice(0, 5)
      .map((heuristic, index) => {
        const confidence = Math.round(heuristic.confidence * 100);
        return `${index + 1}. ${heuristic.label} (confiança ${confidence}%) - ${heuristic.detail}`;
      })
      .join('\n');
  }

  private composePrompt(source: SegmentSource): PromptSegment {
    const mergedHeuristics = [...this.globalHeuristics, ...source.record.heuristics];
    const heuristicSummary = this.composeHeuristicSummary(mergedHeuristics);
    const prompt = [
      this.baseInstruction.trim(),
      'Contexto resumido da nota fiscal:',
      source.summary.trim(),
      'Sinais heurísticos prioritários:',
      heuristicSummary,
      'Gere uma resposta estruturada em português respeitando o schema JSON fornecido.',
    ].join('\n\n');

    return {
      id: source.record.id,
      prompt,
      contextKey: `segment-${source.record.id}`,
      weight: mergedHeuristics.reduce((total, heuristic) => total + heuristic.weight, 0) || 1,
    };
  }

  public createSegments(sources: SegmentSource[]): PromptSegment[] {
    return sources.map((source) => this.composePrompt(source));
  }

  public async executeSegments<T>(
    sources: SegmentSource[],
    model: string,
    schema: ResponseSchema,
  ): Promise<PromptExecutionResult<T>> {
    const segments = this.createSegments(sources);
    const outputs: Record<string, T> = {};

    for (const segment of segments) {
      const response = await generateJSON<T>(model, segment.prompt, schema, segment.contextKey);
      outputs[segment.id] = response;
    }

    return { outputs, segments };
  }
}

export type { SegmentSource };
