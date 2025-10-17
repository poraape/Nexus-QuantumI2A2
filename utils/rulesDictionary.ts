import type { Inconsistency } from '../types';

export const INCONSISTENCIES: Record<string, Inconsistency> = {
    CFOP_SAIDA_EM_COMPRA: {
        code: 'CFOP-INV-01',
        message: 'CFOP de saída (5xxx/6xxx) em operação de compra.',
        explanation: 'O CFOP indica uma Venda/Remessa, mas a empresa é a destinatária. Para compras, o CFOP deveria ser de entrada (1xxx/2xxx). Isso pode indicar erro de digitação ou fraude fiscal.'
    },
    NCM_SERVICO_PARA_PRODUTO: {
        code: 'NCM-INV-01',
        message: 'NCM "00000000" usado para um item que parece ser um produto.',
        explanation: 'O NCM "00000000" é reservado para serviços ou itens sem classificação. Se o item é um bem físico, ele deve ter um código NCM específico da tabela TIPI. A classificação incorreta afeta a tributação de IPI e ICMS.'
    },
    NCM_INVALIDO: {
        code: 'NCM-INV-02',
        message: 'Código NCM possui formato inválido.',
        explanation: 'O NCM deve ser um código de 8 dígitos. Um formato incorreto pode indicar erro de cadastro e levar à rejeição da NFe ou a uma tributação errada.'
    },
    VALOR_CALCULO_DIVERGENTE: {
        code: 'VAL-ERR-01',
        message: 'Valor total do item (vProd) não corresponde a Qtd x Vlr. Unit.',
        explanation: 'A multiplicação da quantidade pelo valor unitário diverge do valor total do produto. Isso pode indicar erros de arredondamento, descontos não informados ou manipulação de valores.'
    },
    VALOR_PROD_ZERO: {
        code: 'VAL-WARN-01',
        message: 'Produto com valor total zerado.',
        explanation: 'O valor total do produto é zero. Isso pode ser uma bonificação, doação ou amostra, que exige um CFOP específico (e.g., 5910/6910) e pode ter tratamento tributário diferenciado.'
    }
};
