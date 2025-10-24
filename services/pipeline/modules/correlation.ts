import type { DocumentSection } from './documentReader';
import type { ExtractionResult, ExtractedSignal, HeuristicSignal } from './dataExtractor';

export interface CorrelatedRecord {
  id: string;
  sectionId: string;
  invoiceId?: string;
  documentName: string;
  cnpjs: string[];
  taxes: number[];
  monetaryValues: number[];
  heuristics: HeuristicSignal[];
  signals: ExtractedSignal[];
}

export interface CorrelationResult {
  records: CorrelatedRecord[];
  heuristics: HeuristicSignal[];
}

function buildRecordId(sectionId: string, invoiceId?: string): string {
  return invoiceId ? `${sectionId}-${invoiceId}` : sectionId;
}

export function correlateSignals(result: ExtractionResult): CorrelationResult {
  const { sections, signals, heuristics } = result;
  const sectionMap = new Map<string, DocumentSection>();
  sections.forEach((section) => sectionMap.set(section.id, section));

  const sectionSignals = new Map<string, ExtractedSignal[]>();
  signals.forEach((signal) => {
    const existing = sectionSignals.get(signal.sectionId) ?? [];
    existing.push(signal);
    sectionSignals.set(signal.sectionId, existing);
  });

  const sectionHeuristics = new Map<string, HeuristicSignal[]>();
  const globalHeuristics: HeuristicSignal[] = [];

  heuristics.forEach((heuristic) => {
    if (heuristic.scope === 'global') {
      globalHeuristics.push(heuristic);
      return;
    }
    const existing = sectionHeuristics.get(heuristic.scope) ?? [];
    existing.push(heuristic);
    sectionHeuristics.set(heuristic.scope, existing);
  });

  const records: CorrelatedRecord[] = [];

  sectionSignals.forEach((sectionSignalList, sectionId) => {
    const section = sectionMap.get(sectionId);
    if (!section) {
      return;
    }

    const invoices = sectionSignalList.filter((signal) => signal.type === 'INVOICE').map((signal) => signal.value);
    const cnpjs = sectionSignalList.filter((signal) => signal.type === 'CNPJ').map((signal) => signal.value);
    const taxes = sectionSignalList
      .filter((signal) => signal.type === 'TAX_PERCENTAGE' && typeof signal.numericValue === 'number')
      .map((signal) => signal.numericValue ?? 0);
    const monetaryValues = sectionSignalList
      .filter((signal) => signal.type === 'MONETARY_VALUE' && typeof signal.numericValue === 'number')
      .map((signal) => signal.numericValue ?? 0);

    const invoiceId = invoices[0];
    const recordId = buildRecordId(sectionId, invoiceId);
    const recordHeuristics = [...(sectionHeuristics.get(sectionId) ?? [])];

    records.push({
      id: recordId,
      sectionId,
      invoiceId,
      documentName: section.documentName,
      cnpjs,
      taxes,
      monetaryValues,
      heuristics: recordHeuristics,
      signals: sectionSignalList,
    });
  });

  const cnpjOccurrences = new Map<string, number>();
  records.forEach((record) => {
    record.cnpjs.forEach((cnpj) => {
      cnpjOccurrences.set(cnpj, (cnpjOccurrences.get(cnpj) ?? 0) + 1);
    });
  });

  cnpjOccurrences.forEach((count, cnpj) => {
    if (count > 1) {
      globalHeuristics.push({
        id: `global-cnpj-${cnpj}`,
        label: 'CNPJ repetido em múltiplas notas',
        detail: `O CNPJ ${cnpj} aparece em ${count} seções distintas, revisar consistência de fornecedores.`,
        confidence: 0.7,
        scope: 'global',
        evidence: records
          .filter((record) => record.cnpjs.includes(cnpj))
          .map((record) => `Seção ${record.sectionId} (${record.documentName})`),
        weight: 1.2,
      });
    }
  });

  return {
    records,
    heuristics: globalHeuristics,
  };
}
