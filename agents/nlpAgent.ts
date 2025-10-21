// nlpAgent.ts
import { Type } from "@google/genai";
import { logger } from "../services/logger";
import { generateJSON } from "../services/geminiService";

const nlpExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    data_emissao: { type: Type.STRING, description: "Data de emissão no formato DD/MM/AAAA.", nullable: true },
    valor_total_nfe: { type: Type.NUMBER, description: "Valor monetário total da nota.", nullable: true },
    emitente_nome: { type: Type.STRING, nullable: true },
    emitente_cnpj: { type: Type.STRING, nullable: true },
    destinatario_nome: { type: Type.STRING, nullable: true },
    destinatario_cnpj: { type: Type.STRING, nullable: true },
    items: {
      type: Type.ARRAY,
      description: "Lista de todos os produtos ou serviços na nota.",
      items: {
        type: Type.OBJECT,
        properties: {
          produto_nome: { type: Type.STRING },
          produto_ncm: { type: Type.STRING, nullable: true },
          produto_cfop: { type: Type.STRING, nullable: true },
          produto_qtd: { type: Type.NUMBER, nullable: true },
          produto_valor_unit: { type: Type.NUMBER, nullable: true },
          produto_valor_total: { type: Type.NUMBER, nullable: true },
        },
        required: ['produto_nome'],
      },
    },
  },
};

const regexFallback = (text: string) => {
  const lines = text.split(/\r?\n/);
  const out: any[] = [];
  let total = 0;
  for (const ln of lines) {
    const m = ln.match(/(\d{2,8})\s+(.*?)(\d+[.,]\d{2})\s*$/);
    if (m) {
      const ncm = m[1];
      const nome = m[2].trim();
      const v = parseFloat(m[3].replace(/\./g, '').replace(',', '.'));
      total += isNaN(v) ? 0 : v;
      out.push({ produto_ncm: ncm, produto_nome: nome, produto_valor_total: v });
    }
  }
  if (!out.length) {
    const t = text.match(/total\s*[:=]?\s*(\d+[.,]\d{2})/i);
    if (t) {
      out.push({ produto_nome: 'TOTAL', produto_valor_total: parseFloat(t[1].replace(/\./g, '').replace(',', '.')) });
    }
  }
  return out;
};

/**
 * Tenta extrair dados fiscais estruturados de um bloco de texto usando a IA do Gemini.
 * @param text O texto bruto extraído de um PDF ou imagem.
 * @returns Uma promessa que resolve para um array de objetos de dados extraídos. Retorna array vazio se nada for encontrado.
 */
export const extractDataFromText = async (text: string): Promise<Record<string, any>[]> => {
    if (!text || text.trim().length < 20) {
        logger.log('nlpAgent', 'WARN', 'Texto muito curto para extração com IA, pulando.');
        return [];
    }

    const truncatedText = text.length > 15000 ? text.substring(0, 15000) : text;

    const prompt = `
      Você é um sistema de extração de dados (OCR/NLP) especializado em documentos fiscais brasileiros.
      Analise o texto a seguir e extraia as informações estruturadas de acordo com o schema JSON fornecido.
      - Se um campo não for encontrado, omita-o ou use null.
      - Converta todos os valores monetários para números (ex: "1.234,56" se torna 1234.56).
      - Se múltiplos itens forem encontrados, liste todos eles no array 'items'.
      - Se for um DANFE, pode haver apenas um item genérico representando a nota inteira.

      Texto para análise:
      ---
      ${truncatedText}
      ---
    `;

    try {
        const out = await generateJSON('gemini-2.5-flash', prompt, nlpExtractionSchema) as any;
        let items = Array.isArray(out?.items) ? out.items : [];
        if (!items.length) {
            logger.log('nlpAgent', 'WARN', 'LLM vazio, usando regexFallback');
            items = regexFallback(truncatedText);
        }
        return items;
    } catch (e) {
        logger.log('nlpAgent', 'ERROR', 'Falha IA; usando regexFallback', { error: e });
        return regexFallback(truncatedText);
    }
};
