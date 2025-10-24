import type { DocumentSection } from './documentReader';

export type ExtractedSignalType = 'CNPJ' | 'INVOICE' | 'TAX_PERCENTAGE' | 'MONETARY_VALUE';

export interface ExtractedSignal {
  id: string;
  type: ExtractedSignalType;
  value: string;
  numericValue?: number;
  sectionId: string;
  rule: string;
  confidence: number;
  context: string;
}

export interface HeuristicSignal {
  id: string;
  label: string;
  detail: string;
  confidence: number;
  scope: string;
  evidence: string[];
  weight: number;
}

export interface ExtractionResult {
  sections: DocumentSection[];
  signals: ExtractedSignal[];
  heuristics: HeuristicSignal[];
}

const CNPJ_REGEX = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const INVOICE_REGEX = /\bNF[-\s]?\d{3,}\b/gi;
const TAX_REGEX = /(?:(?:al[ií]quota|taxa|imposto)\s*[:=-]?\s*)?(\d{1,2}(?:,\d{1,2})?)\s*%/gi;
const VALUE_REGEX = /R\$\s*([\d\.\s]+,\d{2})/gi;

let globalSignalCounter = 0;

function nextSignalId(prefix: string): string {
  globalSignalCounter += 1;
  return `${prefix}-${globalSignalCounter}`;
}

function normalizeCurrency(value: string): number {
  const sanitized = value.replace(/[^\d,]/g, '').replace('.', '').replace(',', '.');
  const numeric = Number.parseFloat(sanitized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizePercentage(value: string): number {
  const sanitized = value.replace(',', '.');
  const numeric = Number.parseFloat(sanitized);
  return Number.isFinite(numeric) ? numeric / 100 : 0;
}

function buildHeuristic(
  label: string,
  detail: string,
  scope: string,
  evidence: string[],
  confidence = 0.7,
  weight = 1,
): HeuristicSignal {
  return {
    id: nextSignalId('heuristic'),
    label,
    detail,
    scope,
    evidence,
    confidence,
    weight,
  };
}

export function extractSignals(sections: DocumentSection[]): ExtractionResult {
  const signals: ExtractedSignal[] = [];
  const heuristics: HeuristicSignal[] = [];

  sections.forEach((section) => {
    const localEvidence: string[] = [];

    section.text.replace(CNPJ_REGEX, (match) => {
      const signal: ExtractedSignal = {
        id: nextSignalId('cnpj'),
        type: 'CNPJ',
        value: match,
        sectionId: section.id,
        rule: 'CNPJ padrão',
        confidence: 0.9,
        context: section.text,
      };
      signals.push(signal);
      localEvidence.push(`CNPJ ${match}`);
      return match;
    });

    section.text.replace(INVOICE_REGEX, (match) => {
      const normalized = match.toUpperCase();
      const signal: ExtractedSignal = {
        id: nextSignalId('invoice'),
        type: 'INVOICE',
        value: normalized,
        sectionId: section.id,
        rule: 'Padrão NF-XXXX',
        confidence: 0.85,
        context: section.text,
      };
      signals.push(signal);
      localEvidence.push(`Nota ${normalized}`);
      return match;
    });

    section.text.replace(TAX_REGEX, (_match, value: string) => {
      const numericValue = normalizePercentage(value);
      const signal: ExtractedSignal = {
        id: nextSignalId('tax'),
        type: 'TAX_PERCENTAGE',
        value,
        numericValue,
        sectionId: section.id,
        rule: 'Taxa percentual identificada por regex',
        confidence: 0.8,
        context: section.text,
      };
      signals.push(signal);
      localEvidence.push(`Alíquota ${value}%`);

      if (numericValue >= 0.25) {
        heuristics.push(
          buildHeuristic(
            'Alíquota acima da média do setor',
            `Percentual identificado em ${value}% indica potencial risco fiscal`,
            section.id,
            [section.text],
            0.85,
            2,
          ),
        );
      }

      if (numericValue === 0) {
        heuristics.push(
          buildHeuristic(
            'Percentual igual a zero',
            'Identificado imposto com percentual zero, revisar benefícios fiscais aplicados.',
            section.id,
            [section.text],
            0.6,
            1,
          ),
        );
      }

      return value;
    });

    section.text.replace(VALUE_REGEX, (_match, value: string) => {
      const numericValue = normalizeCurrency(value);
      const signal: ExtractedSignal = {
        id: nextSignalId('value'),
        type: 'MONETARY_VALUE',
        value,
        numericValue,
        sectionId: section.id,
        rule: 'Valor monetário com prefixo R$',
        confidence: 0.75,
        context: section.text,
      };
      signals.push(signal);
      localEvidence.push(`Valor R$ ${value}`);

      if (numericValue > 50000) {
        heuristics.push(
          buildHeuristic(
            'Valor elevado identificado',
            `Valor unitário de R$ ${value} excede o limite de auditoria rápida`,
            section.id,
            [section.text],
            0.8,
            1.5,
          ),
        );
      }

      return value;
    });

    if (localEvidence.length === 0) {
      heuristics.push(
        buildHeuristic(
          'Seção sem sinais fiscais relevantes',
          'Trecho analisado não contém dados fiscais estruturados.',
          section.id,
          [section.text],
          0.4,
          0.5,
        ),
      );
    }
  });

  return {
    sections,
    signals,
    heuristics,
  };
}
