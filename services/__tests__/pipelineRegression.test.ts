import { spawnSync } from 'node:child_process';

const mockGenerateJSON = jest.fn();

jest.mock('../geminiService', () => ({
  generateJSON: (...args: any[]) => mockGenerateJSON(...args),
}));

describe('pipeline fiscal end-to-end regression', () => {
  beforeEach(() => {
    mockGenerateJSON.mockReset();
  });

  it('executa o fluxo completo e valida relatórios de auditoria', async () => {
    mockGenerateJSON.mockImplementation(async (_model: string, _prompt: string, _schema: any, contextKey?: string) => ({
      summary: `Análise automatizada para ${contextKey}`,
      riskLevel: contextKey?.includes('NF-1001') ? 'ALTO' : 'MODERADO',
      recommendedActions: ['Revisar lançamento fiscal', 'Solicitar documentação complementar'],
    }));

    const { runPipeline } = await import('../pipeline');

    const pipelineOutput = await runPipeline({
      documents: [
        {
          name: 'nf-1001.txt',
          content:
            'Nota Fiscal: NF-1001\nFornecedor: ABC Serviços\nCNPJ: 12.345.678/0001-90\nAlíquota aplicada: 27,5%\nValor total: R$ 150.000,00',
        },
        {
          name: 'nf-1002.txt',
          content:
            'Nota Fiscal NF-1002\nFornecedor: XYZ Tecnologia\nCNPJ: 98.765.432/0001-10\nImposto devido: 15,0%\nValor total: R$ 8.500,00',
        },
      ],
      model: 'gemini-pro',
    });

    expect(mockGenerateJSON).toHaveBeenCalledTimes(pipelineOutput.correlation.records.length);

    const [firstCall] = mockGenerateJSON.mock.calls;
    expect(firstCall[1]).toContain('NF-1001');
    expect(firstCall[1]).toContain('Alíquotas encontradas');

    const baseline = pipelineOutput.correlation.records.map((record) => ({
      record_id: record.id,
      tax: record.taxes[0] ?? 0,
      total: record.monetaryValues[0] ?? 0,
    }));

    const candidate = baseline.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            tax: Number((entry.tax * 1.3).toFixed(4)),
          }
        : entry,
    );

    const divergentReport = runConsistencyChecker(baseline, candidate);
    expect(divergentReport.status).toBe('divergent');
    expect(divergentReport.differences.some((difference: any) => difference.metric === 'tax')).toBe(true);

    const stableReport = runConsistencyChecker(baseline, baseline);
    expect(stableReport.status).toBe('ok');
  });
});

function runConsistencyChecker(
  baseline: Array<Record<string, any>>,
  candidate: Array<Record<string, any>>,
): Record<string, any> {
  const baselineEncoded = Buffer.from(JSON.stringify(baseline), 'utf-8').toString('base64');
  const candidateEncoded = Buffer.from(JSON.stringify(candidate), 'utf-8').toString('base64');

  const pythonScript = `
import base64
import json
from services.audit.consistency_checker import ConsistencyChecker
baseline = json.loads(base64.b64decode('${baselineEncoded}').decode('utf-8'))
candidate = json.loads(base64.b64decode('${candidateEncoded}').decode('utf-8'))
checker = ConsistencyChecker()
report = checker.generate_report(baseline, candidate)
print(json.dumps(report))
`;

  const result = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Falha ao executar verificador de consistência.');
  }

  return JSON.parse(result.stdout.trim());
}
