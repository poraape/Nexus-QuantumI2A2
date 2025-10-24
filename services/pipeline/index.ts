import type { ResponseSchema } from '../geminiService';
import { readDocuments, type PipelineDocument } from './modules/documentReader';
import { extractSignals } from './modules/dataExtractor';
import { correlateSignals } from './modules/correlation';
import { generateInsights } from './modules/insights';

export interface PipelineInput {
  documents: PipelineDocument[];
}

export interface PipelineOptions {
  model: string;
  schema?: ResponseSchema;
  baseInstruction?: string;
}

export async function runPipeline(input: PipelineInput & PipelineOptions) {
  const reading = readDocuments(input.documents);
  const extraction = extractSignals(reading.sections);
  const correlation = correlateSignals(extraction);
  const insights = await generateInsights(correlation, {
    model: input.model,
    schema: input.schema,
    baseInstruction: input.baseInstruction,
  });

  return {
    reading,
    extraction,
    correlation,
    insights,
  };
}

export type { PipelineDocument };
