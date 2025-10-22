import { runClassification } from '../classifierAgent';
import type { AuditReport, AuditedDocument, ImportedDoc } from '../../types';

describe('runClassification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const baseDoc: ImportedDoc = {
    kind: 'NFE_XML',
    name: 'doc.xml',
    size: 100,
    status: 'parsed',
  };

  const baseReport: Omit<AuditReport, 'summary'> = {
    documents: [
      {
        doc: { ...baseDoc, data: [{ produto_cfop: '6101', produto_ncm: '84715010' }] },
        status: 'OK',
        inconsistencies: [],
      },
    ],
  };

  it('applies user corrections with full confidence', async () => {
    const withClassification: AuditedDocument = {
      ...baseReport.documents[0],
      classification: {
        operationType: 'Compra',
        businessSector: 'Máquinas e Equipamentos',
        confidence: 0.5,
      },
    };

    const promise = runClassification({ ...baseReport, documents: [withClassification] }, {
      'doc.xml': 'Venda',
    });
    jest.runAllTimers();
    const result = await promise;

    expect(result.documents[0].classification?.operationType).toBe('Venda');
    expect(result.documents[0].classification?.confidence).toBe(1);
  });

  it('infers operation type from CFOP data when no correction exists', async () => {
    const docs: AuditedDocument[] = [
      {
        doc: { ...baseDoc, data: [
          { produto_cfop: '5102', produto_ncm: '84715010' },
          { produto_cfop: '5102', produto_ncm: '84715010' },
          { produto_cfop: '5102', produto_ncm: '84715010' },
        ] },
        status: 'OK',
        inconsistencies: [],
      },
    ];

    const promise = runClassification({ ...baseReport, documents: docs }, {});
    jest.runAllTimers();
    const result = await promise;

    expect(result.documents[0].classification?.operationType).toBe('Venda');
    expect(result.documents[0].classification?.businessSector).toBe('Tecnologia da Informação');
    expect(result.documents[0].classification?.confidence).toBeGreaterThan(0.5);
  });
});
