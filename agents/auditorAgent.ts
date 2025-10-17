import type { ImportedDoc, AuditReport, AuditedDocument, AuditStatus, Inconsistency } from '../types';
import { runFiscalValidation } from '../utils/rulesEngine';

/**
 * Runs a deterministic fiscal audit on a list of imported documents.
 * It uses a rules engine to find real inconsistencies.
 * @param docs The array of ImportedDoc from the import pipeline.
 * @returns A promise that resolves with an AuditReport object.
 */
export const runAudit = async (docs: ImportedDoc[]): Promise<Omit<AuditReport, 'summary'>> => {
  console.log(`Auditor Agent: Auditing ${docs.length} documents.`);

  const auditedDocuments: AuditedDocument[] = docs.map(doc => {
    // If the document already has an error from the import pipeline
    if (doc.status === 'error' || doc.status === 'unsupported') {
      return {
        doc,
        status: 'ERRO',
        inconsistencies: [{
          code: 'IMPORT-FAIL',
          message: doc.error || 'Falha na importação ou formato não suportado.',
          explanation: `O arquivo "${doc.name}" não pôde ser lido corretamente. Verifique se o arquivo não está corrompido e se o formato é um dos suportados.`,
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

    // Deduplicate inconsistencies based on code
    const uniqueInconsistencies = Array.from(new Map(allInconsistencies.map(item => [item.code, item])).values());
    
    let status: AuditStatus = 'OK';
    if (uniqueInconsistencies.length > 0) {
        // A simple logic: if any inconsistency message contains "inválido" or "divergente", it's an error. Otherwise, it's a warning.
        const hasError = uniqueInconsistencies.some(inc => inc.message.toLowerCase().includes('inválido') || inc.message.toLowerCase().includes('divergente') || inc.message.toLowerCase().includes('compra'));
        status = hasError ? 'ERRO' : 'ALERTA';
    }

    return {
      doc,
      status,
      inconsistencies: uniqueInconsistencies,
    };
  });

  // Simulate computation time
  await new Promise(resolve => setTimeout(resolve, 500 + docs.length * 10));

  return {
    documents: auditedDocuments,
  };
};