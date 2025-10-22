import type { ImportedDoc, AuditReport, AuditedDocument, AuditStatus, Inconsistency } from '../types';
import { runFiscalValidation } from '../utils/rulesEngine';
import { measureExecution, telemetry } from '../services/telemetry';
import { logger } from '../services/logger';

const SEVERITY_WEIGHTS: Record<Inconsistency['severity'], number> = {
    'ERRO': 10,
    'ALERTA': 2,
    'INFO': 0,
};

/**
 * Runs a deterministic fiscal audit on a list of imported documents.
 * It uses a rules engine to find real inconsistencies.
 * @param docs The array of ImportedDoc from the import pipeline.
 * @returns A promise that resolves with an AuditReport object.
 */
export const runAudit = async (docs: ImportedDoc[], correlationId?: string): Promise<Omit<AuditReport, 'summary'>> => {
  const cid = correlationId || telemetry.createCorrelationId('agent');
  logger.log('Auditor', 'INFO', `Iniciando auditoria de ${docs.length} documentos.`, undefined, { correlationId: cid, scope: 'agent' });

  return measureExecution('agent', 'Auditor.runAudit', async () => {
    const auditedDocuments: AuditedDocument[] = docs.map(doc => {
      if (doc.status === 'error' || doc.status === 'unsupported') {
        return {
          doc,
          status: 'ERRO',
          score: 99,
          inconsistencies: [{
            code: 'IMPORT-FAIL',
            message: doc.error || 'Falha na importação ou formato não suportado.',
            explanation: `O arquivo "${doc.name}" não pôde ser lido corretamente. Verifique se o arquivo não está corrompido e se o formato é um dos suportados.`,
            severity: 'ERRO',
          }],
        };
      }

      let allInconsistencies: Inconsistency[] = [];
      if(doc.data){
          for(const item of doc.data){
              const findings = runFiscalValidation(item);
              allInconsistencies.push(...findings);
          }
      }

      const uniqueInconsistencies = Array.from(new Map(allInconsistencies.map(item => [item.code, item])).values());

      let status: AuditStatus = 'OK';
      if (uniqueInconsistencies.length > 0) {
          if (uniqueInconsistencies.some(inc => inc.severity === 'ERRO')) {
              status = 'ERRO';
          } else if (uniqueInconsistencies.some(inc => inc.severity === 'ALERTA')) {
              status = 'ALERTA';
          }
      }

      const score = uniqueInconsistencies.reduce((acc, inc) => {
          return acc + (SEVERITY_WEIGHTS[inc.severity] || 0);
      }, 0);

      return {
        doc,
        status,
        score,
        inconsistencies: uniqueInconsistencies,
      };
    });

    await new Promise(resolve => setTimeout(resolve, 500 + docs.length * 10));

    logger.log('Auditor', 'INFO', 'Auditoria concluída.', { documents: docs.length }, { correlationId: cid, scope: 'agent' });

    return {
      documents: auditedDocuments,
    };
  }, { correlationId: cid, attributes: { documents: docs.length } });
};