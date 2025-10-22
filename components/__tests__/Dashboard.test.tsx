import { render, screen } from '@testing-library/react';
import Dashboard from '../Dashboard';
import type { AuditReport } from '../../types';

const chartSpy = jest.fn();
const smartSearchSpy = jest.fn();
const analysisSpy = jest.fn();
const crossValidationSpy = jest.fn();

jest.mock('../Chart', () => (props: any) => {
  chartSpy(props);
  return <div data-testid={`chart-${props.title}`}>{props.title}</div>;
});

jest.mock('../SmartSearch', () => (props: any) => {
  smartSearchSpy(props);
  return <div data-testid="smart-search" />;
});

jest.mock('../AnalysisDisplay', () => (props: any) => {
  analysisSpy(props);
  return <div data-testid="analysis-display" />;
});

jest.mock('../CrossValidationPanel', () => (props: any) => {
  crossValidationSpy(props);
  return <div data-testid="cross-validation" />;
});

describe('Dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const buildReport = (): AuditReport => ({
    summary: {
      title: 'Resumo',
      summary: 'texto',
      keyMetrics: [],
      actionableInsights: [],
    },
    documents: [
      {
        doc: {
          kind: 'NFE_XML',
          name: 'doc1',
          size: 1,
          status: 'parsed',
          data: [
            {
              produto_cfop: '5102',
              produto_ncm: '84715010',
              produto_valor_total: '100',
              emitente_uf: 'SP',
              destinatario_uf: 'RJ',
            },
            {
              produto_cfop: '6101',
              produto_ncm: '85423190',
              produto_valor_total: '50',
              emitente_uf: 'SP',
              destinatario_uf: 'MG',
            },
          ],
        },
        status: 'OK',
        inconsistencies: [],
      },
    ],
    aggregatedMetrics: {},
    deterministicCrossValidation: [{ comparisonKey: 'Produto', attribute: 'Preço', description: 'desc', discrepancies: [], severity: 'ALERTA' }],
    crossValidationResults: [{ attribute: 'CFOP', observation: 'ok', documents: [] }],
  });

  it('renders charts and computes ICMS simulation based on report data', () => {
    render(<Dashboard report={buildReport()} />);

    expect(screen.getByText('Dashboard Interativo')).toBeInTheDocument();
    expect(chartSpy).toHaveBeenCalledTimes(3);

    const slider = screen.getByRole('slider');
    expect(parseFloat((slider as HTMLInputElement).value)).toBeGreaterThan(0);
    expect(screen.getByText('ICMS Estimado')).toBeInTheDocument();

    expect(smartSearchSpy).toHaveBeenCalledWith(expect.objectContaining({ report: expect.any(Object) }));
    expect(analysisSpy).toHaveBeenCalledWith(expect.objectContaining({ results: expect.any(Array) }));
    expect(crossValidationSpy).toHaveBeenCalledWith(expect.objectContaining({ results: expect.any(Array) }));
  });
});
