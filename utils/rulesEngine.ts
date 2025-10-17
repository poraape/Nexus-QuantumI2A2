import { INCONSISTENCIES } from './rulesDictionary';
import type { Inconsistency } from '../types';

export const runFiscalValidation = (item: Record<string, any>): Inconsistency[] => {
  const findings: Inconsistency[] = [];
  const cfop = item.produto_cfop?.toString() || '';
  const ncm = item.produto_ncm?.toString() || '';
  const qCom = parseFloat(item.produto_qtd || 0);
  const vUnCom = parseFloat(item.produto_valor_unit || 0);
  const vProd = parseFloat(item.produto_valor_total || 0);

  // Rule 1: Validate CFOP for sales vs. purchases.
  // This is a simplified check. A real system would cross-reference against more company data.
  if (cfop.startsWith('5') || cfop.startsWith('6')) {
    // CFOP indicates a sale. If the recipient name matches a known company name for internal transfers/purchases, flag it.
    if (item.destinatario_nome?.toLowerCase().includes('quantum innovations')) {
        findings.push(INCONSISTENCIES.CFOP_SAIDA_EM_COMPRA);
    }
  }

  // Rule 2: NCM validation
  if (ncm === '00000000' && !item.produto_nome?.toLowerCase().includes('serviço') && !item.produto_nome?.toLowerCase().includes('consultoria')) {
    findings.push(INCONSISTENCIES.NCM_SERVICO_PARA_PRODUTO);
  }
  if (ncm && ncm !== '00000000' && ncm.length !== 8) {
      findings.push(INCONSISTENCIES.NCM_INVALIDO);
  }

  // Rule 3: Value calculation check
  if (qCom > 0 && vUnCom > 0 && vProd > 0) {
      const calculatedTotal = qCom * vUnCom;
      const difference = Math.abs(calculatedTotal - vProd);
      // Allow for a small rounding difference (e.g., 0.1% of value or 1 cent)
      if (difference > (calculatedTotal * 0.001) && difference > 0.01) {
          findings.push(INCONSISTENCIES.VALOR_CALCULO_DIVERGENTE);
      }
  }
  
  // Rule 4: Check for zero value products, which should have specific CFOPs (not checked here but flagged).
  if (vProd === 0 && qCom > 0) {
      findings.push(INCONSISTENCIES.VALOR_PROD_ZERO);
  }

  return findings;
};
