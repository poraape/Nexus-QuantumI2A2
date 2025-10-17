import type { ImportedDoc, AuditReport, AuditedDocument, AuditStatus, Inconsistency } from '../types';

// Mock data for fiscal rule violations (XAI-ready)
const mockInconsistencies: Inconsistency[] = [
  {
    code: 'CFOP-INV-SAIDA',
    message: 'CFOP de saída inválido para operação de compra.',
    explanation: 'O CFOP (Código Fiscal de Operações e Prestações) 5101 indica uma venda, mas o destinatário é a própria empresa, sugerindo uma compra. O CFOP correto para compra de mercadoria para industrialização seria 1101.',
  },
  {
    code: 'NCM-INEXISTENTE',
    message: 'Código NCM não encontrado na tabela TIPI.',
    explanation: 'O NCM (Nomenclatura Comum do Mercosul) "00000000" é utilizado para serviços ou itens sem classificação específica, o que pode ser um alerta para produtos físicos que deveriam ter um NCM válido.',
  },
  {
    code: 'ICMS-ALIQ-DIVERG',
    message: 'Alíquota de ICMS diverge da esperada para a operação.',
    explanation: 'Para uma venda interestadual de produtos industrializados, a alíquota de ICMS esperada seria de 12%, mas o documento não apresenta destaque de imposto, o que pode indicar um erro de cadastro ou uma isenção não declarada.',
  },
   {
    code: 'VAL-PROD-ZERO',
    message: 'Valor do produto está zerado.',
    explanation: 'O valor unitário ou total do produto é zero. Isso geralmente indica uma bonificação, doação ou amostra grátis, que deve ser tratada de forma específica na contabilidade e pode exigir um CFOP apropriado (ex: 5910).',
  }
];

/**
 * Simulates a fiscal audit on a list of imported documents.
 * It assigns a status and mock inconsistencies to each document.
 * @param docs The array of ImportedDoc from the import pipeline.
 * @returns A promise that resolves with an AuditReport object.
 */
export const runAudit = async (docs: ImportedDoc[]): Promise<Omit<AuditReport, 'summary'>> => {
  // Simulate network latency or complex computation
  await new Promise(resolve => setTimeout(resolve, 1500));
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
          explanation: `O arquivo "${doc.name}" não pôde ser lido corretamente. Verifique se o arquivo não está corrompido e se o formato é um dos suportados (XML, PDF, etc.).`,
        }],
      };
    }
    
    // Simulate random audit results for demonstration
    const rand = Math.random();
    let status: AuditStatus = 'OK';
    let inconsistencies: Inconsistency[] = [];

    if (rand < 0.2) { // 20% chance of being ERRO
      status = 'ERRO';
      inconsistencies.push(mockInconsistencies[Math.floor(Math.random() * mockInconsistencies.length)]);
      if (Math.random() < 0.5) { // Sometimes add a second error
         inconsistencies.push(mockInconsistencies[Math.floor(Math.random() * mockInconsistencies.length)]);
      }
    } else if (rand < 0.6) { // 40% chance of being ALERTA
      status = 'ALERTA';
      inconsistencies.push(mockInconsistencies[Math.floor(Math.random() * mockInconsistencies.length)]);
    }
    // Remaining 40% will be OK

    return {
      doc,
      status,
      inconsistencies: [...new Set(inconsistencies)], // Ensure unique inconsistencies
    };
  });

  return {
    documents: auditedDocuments,
  };
};
