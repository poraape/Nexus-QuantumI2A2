// nlpAgent.ts

// Regex simplificados para demonstração. Em um sistema real, seriam mais robustos.
const CNPJ_REGEX = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g;
const VALOR_REGEX = /(?:R\$|VALOR\sTOTAL)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
const DATE_REGEX = /(\d{2}\/\d{2}\/\d{4})/g;
const CFOP_REGEX = /CFOP\s*(\d{4})/gi;
const NCM_REGEX = /NCM\s*(\d{8})/gi;

interface NlpResult {
    emitente_cnpj?: string;
    destinatario_cnpj?: string;
    data_emissao?: string;
    valor_total_nfe?: number;
    produto_nome?: string;
    produto_cfop?: string;
    produto_ncm?: string;
    produto_valor_total?: number;
}

const parseBRL = (value: string): number => {
    return parseFloat(value.replace(/\./g, '').replace(',', '.'));
}

/**
 * Tenta extrair dados fiscais estruturados de um bloco de texto.
 * @param text O texto bruto extraído de um PDF ou imagem.
 * @returns Um array de objetos de dados extraídos. Retorna array vazio se nada for encontrado.
 */
export const extractDataFromText = (text: string): Record<string, any>[] => {
    const result: NlpResult = {};
    const cnpjs = [...text.matchAll(CNPJ_REGEX)].map(m => m[1]);
    if (cnpjs.length > 0) result.emitente_cnpj = cnpjs[0];
    if (cnpjs.length > 1) result.destinatario_cnpj = cnpjs[1];

    const dates = [...text.matchAll(DATE_REGEX)].map(m => m[1]);
    if (dates.length > 0) result.data_emissao = dates[0];
    
    const allValues = [...text.matchAll(VALOR_REGEX)].map(m => parseBRL(m[1]));
    if(allValues.length > 0) {
        result.valor_total_nfe = Math.max(...allValues); // Assume o maior valor é o total da nota
    }

    const cfops = [...text.matchAll(CFOP_REGEX)].map(m => m[1]);
    if (cfops.length > 0) result.produto_cfop = cfops[0];

    const ncms = [...text.matchAll(NCM_REGEX)].map(m => m[1]);
    if (ncms.length > 0) result.produto_ncm = ncms[0];
    
    // Se extraímos pelo menos alguns dados chave, retornamos um item.
    // Uma implementação mais complexa dividiria o texto em itens de produto.
    if (Object.keys(result).length > 2) {
        result.produto_nome = "Item extraído via NLP";
        result.produto_valor_total = result.valor_total_nfe;
        return [result];
    }
    
    return [];
};
