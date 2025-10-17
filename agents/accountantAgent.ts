import { GoogleGenAI, Type } from "@google/genai";
import type { AnalysisResult } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const analysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    keyMetrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          metric: { type: Type.STRING },
          value: { type: Type.STRING },
          insight: { type: Type.STRING },
        },
        required: ['metric', 'value', 'insight'],
      },
    },
    actionableInsights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['title', 'summary', 'keyMetrics', 'actionableInsights'],
};


export const runAccountingAnalysis = async (dataSample: string): Promise<AnalysisResult> => {
  const prompt = `
        Analyze the following sample of fiscal data, provided in CSV format.
        This data represents individual product items extracted from multiple fiscal documents.
        The columns have been normalized. Key columns to focus on include:
        - 'data_emissao': Date of the transaction
        - 'valor_total_nfe': Total value of the entire fiscal note
        - 'emitente_nome': Sender's name
        - 'destinatario_nome': Recipient's name
        - 'produto_nome': Name of the product
        - 'produto_qtd': Quantity of the product
        - 'produto_valor_unit': Unit price of the product
        - 'produto_valor_total': Total value for this product line item

        Generate a concise executive summary for a business analyst.
        Identify key metrics (like total sales, top products, main clients) and actionable insights.
        The analysis must be in Brazilian Portuguese.

        Data Sample:
        ---
        ${dataSample}
        ---

        Return a single JSON object. Do not include any text outside of the JSON object.
    `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: analysisResponseSchema,
    },
  });

  try {
    return JSON.parse(response.text) as AnalysisResult;
  } catch (e) {
    console.error('Failed to parse analysis JSON:', response.text);
    throw new Error('A resposta da IA não estava em um formato JSON válido.');
  }
};
