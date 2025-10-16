// types.ts

// FIX: Export JSZipObject and related interfaces so they can be imported.
export interface JSZipObject {
  name: string;
  dir: boolean;
  async(type: 'string'): Promise<string>;
}

export interface JSZip {
  files: { [key: string]: JSZipObject };
}

export interface JSZipConstructor {
  new (): JSZip;
  loadAsync(data: any): Promise<JSZip>;
}

declare global {
  interface Window {
    JSZip: JSZipConstructor;
    Papa: {
      parse(csvString: string, config: any): void;
      unparse(data: any[]): string;
    };
    jspdf: {
      jsPDF: new (options?: any) => any;
    };
    html2canvas: (element: HTMLElement, options?: any) => Promise<HTMLCanvasElement>;
  }
}

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