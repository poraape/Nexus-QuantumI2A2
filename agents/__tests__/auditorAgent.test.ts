import { runAudit } from '../auditorAgent';
import type { ImportedDoc, Inconsistency } from '../../types';

const mockRunFiscalValidation = jest.fn<Inconsistency[], [Record<string, any>]>();

jest.mock('../../utils/rulesEngine', () => ({
  runFiscalValidation: (item: Record<string, any>) => mockRunFiscalValidation(item),
}));

describe('runAudit', () => {
  beforeEach(() => {
    mockRunFiscalValidation.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('marks documents with import errors as ERRO with high score', async () => {
    const docs: ImportedDoc[] = [
      { kind: 'NFE_XML', name: 'broken.xml', size: 10, status: 'error', error: 'Falha', data: undefined },
    ];

    const promise = runAudit(docs);
    jest.runAllTimers();
    const report = await promise;

    expect(report.documents).toHaveLength(1);
    const [doc] = report.documents;
    expect(doc.status).toBe('ERRO');
    expect(doc.score).toBe(99);
    expect(doc.inconsistencies[0].code).toBe('IMPORT-FAIL');
  });

  it('aggregates and deduplicates inconsistencies while deriving status and score', async () => {
    const docs: ImportedDoc[] = [
      {
        kind: 'NFE_XML',
        name: 'valid.xml',
        size: 10,
        status: 'parsed',
        data: [{ id: 1 }, { id: 2 }],
      },
    ];

    mockRunFiscalValidation
      .mockReturnValueOnce([
        { code: 'A', message: 'a', explanation: 'a', severity: 'ALERTA' },
        { code: 'B', message: 'b', explanation: 'b', severity: 'ERRO' },
      ])
      .mockReturnValueOnce([
        { code: 'A', message: 'a', explanation: 'a', severity: 'INFO' },
      ]);

    const promise = runAudit(docs);
    jest.runAllTimers();
    const report = await promise;

    expect(mockRunFiscalValidation).toHaveBeenCalledTimes(2);
    const [audited] = report.documents;
    expect(audited.status).toBe('ERRO');
    expect(audited.inconsistencies).toHaveLength(2);
    expect(audited.score).toBeGreaterThan(0);
  });
});
