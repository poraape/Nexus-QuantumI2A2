// types.ts

export interface ChartDataPoint {
  label: string;
  value: number; // Y-axis for scatter
  x?: number;    // X-axis for scatter
  color?: string;
}

export interface ChartData {
  type: 'bar' | 'pie' | 'line' | 'scatter';
  title: string;
  data: ChartDataPoint[];
  options?: Record<string, any>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  chartData?: ChartData;
}

export interface KeyMetric {
  metric: string;
  value: string;
  insight: string;
}

export interface AnalysisResult {
  title: string;
  summary: string;
  keyMetrics: KeyMetric[];
  actionableInsights: string[];
}

export interface NfeData {
  fileCount: number;
  totalSize: number;
  fileDetails: { name: string; size: number }[];
  dataSample: string; // CSV string of data sample
}

export type ImportedDoc = {
  kind: "NFE_XML" | "CSV" | "XLSX" | "PDF" | "IMAGE" | "UNSUPPORTED";
  name: string;
  size: number;
  status: "parsed" | "ocr_needed" | "unsupported" | "error";
  data?: Record<string, any>[]; // Parsed data for CSV/XLSX/XML
  text?: string; // Text content for PDF/OCR
  raw?: File;
  error?: string;
  meta?: {
    source_zip: string;
    internal_path: string;
  };
};

// --- New Types for Detailed Audit Report ---

export type AuditStatus = 'OK' | 'ALERTA' | 'ERRO';

export interface Inconsistency {
  code: string;
  message: string;
  explanation: string; // XAI part
  normativeBase?: string; // Legal reference
  severity: 'ERRO' | 'ALERTA' | 'INFO';
}

export interface ClassificationResult {
    operationType: 'Compra' | 'Venda' | 'Devolução' | 'Serviço' | 'Transferência' | 'Outros';
    businessSector: string; // e.g., 'Indústria', 'Comércio', 'Tecnologia'
    confidence: number;
}

export interface AuditedDocument {
  doc: ImportedDoc;
  status: AuditStatus;
  score?: number; // Weighted score of inconsistencies
  inconsistencies: Inconsistency[];
  classification?: ClassificationResult;
}

export interface AccountingEntry {
  docName: string;
  account: string;
  type: 'D' | 'C'; // Débito or Crédito
  value: number;
}

export interface SpedFile {
    filename: string;
    content: string;
}

export interface AuditReport {
  summary: AnalysisResult;
  documents: AuditedDocument[];
  aggregatedMetrics?: Record<string, number | string>;
  accountingEntries?: AccountingEntry[];
  spedFile?: SpedFile;
}
