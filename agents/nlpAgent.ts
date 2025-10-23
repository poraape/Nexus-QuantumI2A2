import { logger } from '../services/logger';
import { generateJSON, ResponseSchema } from '../services/llmService';
import { measureExecution, telemetry } from '../services/telemetry';

const nlpExtractionSchema: ResponseSchema = {
  type: 'object',
  properties: {
    data_emissao: { type: 'string', description: 'Data de emissão no formato DD/MM/AAAA.', nullable: true },
    valor_total_nfe: { type: 'number', description: 'Valor monetário total da nota.', nullable: true },
    emitente_nome: { type: 'string', nullable: true },
    emitente_cnpj: { type: 'string', nullable: true },
    destinatario_nome: { type: 'string', nullable: true },
    destinatario_cnpj: { type: 'string', nullable: true },
    items: {
      type: 'array',
      description: 'Lista de todos os produtos ou serviços na nota.',
      items: {
        type: 'object',
        properties: {
          produto_nome: { type: 'string' },
          produto_ncm: { type: 'string', nullable: true },
          produto_cfop: { type: 'string', nullable: true },
          produto_qtd: { type: 'number', nullable: true },
          produto_valor_unit: { type: 'number', nullable: true },
          produto_valor_total: { type: 'number', nullable: true },
        },
        required: ['produto_nome'],
      },
    },
  },
};

/**
 * Tenta extrair dados fiscais estruturados de um bloco de texto usando a IA.
 * @param text Texto bruto extraído de um PDF ou imagem.
 * @returns Array de registros estruturados. Retorna array vazio se nada for encontrado.
 */
export const extractDataFromText = async (text: string, correlationId?: string): Promise<Record<string, any>[]> => {
  const cid = correlationId || telemetry.createCorrelationId('agent');
  if (!text || text.trim().length < 20) {
    logger.log('nlpAgent', 'WARN', 'Texto muito curto para extração com IA, pulando.', undefined, {
      correlationId: cid,
      scope: 'agent',
    });
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
    const extracted = await measureExecution('agent', 'NLP.extractData', async () => {
      return generateJSON<{ items?: any[] } & Record<string, any>>(
        'gemini-2.0-flash',
        prompt,
        nlpExtractionSchema,
        'ocr-nlp-extraction',
      );
    }, { correlationId: cid, attributes: { textLength: truncatedText.length } });

    if (!extracted.items || extracted.items.length === 0) {
      logger.log('nlpAgent', 'WARN', 'IA não extraiu itens do texto.', undefined, {
        correlationId: cid,
        scope: 'agent',
      });
      return [];
    }

    const { items, ...headerData } = extracted;
    const result = items.map(item => ({
      ...headerData,
      ...item,
    }));

    logger.log('nlpAgent', 'INFO', `IA extraiu ${result.length} item(ns) do texto.`, undefined, {
      correlationId: cid,
      scope: 'agent',
    });
    return result;
  } catch (e) {
    logger.log('nlpAgent', 'ERROR', 'Falha na extração de dados com IA.', { error: e }, {
      correlationId: cid,
      scope: 'agent',
    });
    return [];
  }
};
