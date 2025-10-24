describe('Classification corrections persistence', () => {
  it('persists corrections via API and reapplies them after reload', () => {
    const jobId = 'job-1';
    let correctionsStore: Array<{ documentName: string; operationType: string; createdBy: string; createdAt: string; updatedAt: string }> = [];

    const backendStates = {
      ocr: { status: 'completed', progress: { step: 'Processando', current: 1, total: 1 } },
      auditor: { status: 'completed', progress: { step: 'Validando', current: 1, total: 1 } },
      classifier: { status: 'completed', progress: { step: 'Classificando', current: 1, total: 1 } },
      crossValidator: { status: 'completed', progress: { step: 'Conferindo', current: 1, total: 1 } },
      intelligence: { status: 'completed', progress: { step: 'IA', current: 1, total: 1 } },
      accountant: { status: 'completed', progress: { step: 'Contabilizando', current: 1, total: 1 } },
    };

    const report = {
      summary: {
        title: 'Resumo Demo',
        summary: 'Dados processados com sucesso.',
        keyMetrics: [],
        actionableInsights: [],
      },
      documents: [
        {
          doc: { kind: 'NFE_XML', name: 'doc-1.xml', size: 1024, status: 'parsed', data: [] },
          status: 'OK',
          inconsistencies: [],
          classification: {
            operationType: 'Venda',
            businessSector: 'Tecnologia',
            confidence: 0.8,
          },
        },
      ],
      aggregatedMetrics: {},
      accountingEntries: [],
      aiDrivenInsights: [],
    };

    cy.intercept('POST', '**/api/session', {
      statusCode: 200,
      body: { expiresAt: Date.now() + 60 * 60 * 1000 },
    }).as('createSession');

    cy.intercept('POST', '**/api/analysis', {
      statusCode: 200,
      body: { jobId, status: 'running', agentStates: backendStates, result: null },
    }).as('startAnalysis');

    cy.intercept('GET', `**/api/analysis/${jobId}/progress`, {
      statusCode: 200,
      body: { jobId, status: 'completed', agentStates: backendStates, error: null, result: report },
    }).as('pollAnalysis');

    cy.intercept('GET', `**/api/analysis/${jobId}/corrections`, () => ({
      jobId,
      corrections: correctionsStore,
    })).as('fetchCorrections');

    cy.intercept('POST', `**/api/analysis/${jobId}/corrections`, req => {
      const { documentName, operationType } = req.body as { documentName: string; operationType: string };
      const timestamp = new Date().toISOString();
      correctionsStore = [
        {
          documentName,
          operationType,
          createdBy: 'tester',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ];
      req.reply({ jobId, corrections: correctionsStore });
    }).as('saveCorrection');

    cy.intercept('POST', '**/api/chat/sessions', { session_id: 'session-1' }).as('createChat');
    cy.intercept('POST', '**/api/chat/sessions/session-1/messages', { response: { text: 'ok' } }).as('chatMessage');

    cy.visit('/', {
      onBeforeLoad(win) {
        class MockEventSource {
          onerror: ((event: Event) => void) | null = null;
          constructor() {
            setTimeout(() => {
              this.onerror?.(new Event('error'));
            }, 0);
          }
          addEventListener() {
            // no-op
          }
          close() {
            // no-op
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (win as any).EventSource = MockEventSource as any;
      },
    });

    cy.contains('Não tem um arquivo? Use um exemplo de demonstração.').click();
    cy.contains('Analisar 1 Arquivo(s)').click();

    cy.wait('@startAnalysis');
    cy.wait('@fetchCorrections');
    cy.wait('@pollAnalysis');

    cy.get('select').first().should('have.value', 'Venda');

    cy.get('select').first().select('Compra');
    cy.wait('@saveCorrection');

    cy.reload();

    cy.contains('Não tem um arquivo? Use um exemplo de demonstração.').click();
    cy.contains('Analisar 1 Arquivo(s)').click();

    cy.wait('@startAnalysis');
    cy.wait('@fetchCorrections');
    cy.wait('@pollAnalysis');

    cy.get('select').first().should('have.value', 'Compra');
  });
});
