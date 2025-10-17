import { GoogleGenAI, Chat, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const chatResponseSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING, description: "Textual response to the user's query." },
    chartData: {
      type: Type.OBJECT,
      description: "Optional: Chart data if the query can be visualized.",
      properties: {
        type: { type: Type.STRING, enum: ['bar', 'pie', 'line', 'scatter'], description: "Type of chart." },
        title: { type: Type.STRING, description: "Title of the chart." },
        data: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              value: { type: Type.NUMBER },
              x: { type: Type.NUMBER, nullable: true, description: "X-value for scatter plots." }
            },
            required: ['label', 'value'],
          },
        },
        xAxisLabel: { type: Type.STRING, nullable: true },
        yAxisLabel: { type: Type.STRING, nullable: true },
      },
      nullable: true,
    },
  },
  required: ['text'],
};

export const startChat = (dataSample: string): Chat => {
  const systemInstruction = `
        You are an expert fiscal data analyst assistant.
        The user has provided you with a data sample in CSV format, extracted from fiscal documents. The columns have been normalized.
        Key columns include: 'data_emissao', 'valor_total_nfe', 'emitente_nome', 'destinatario_nome', 'produto_nome', 'produto_qtd', 'produto_valor_unit', 'produto_valor_total'.
        Your context is this data sample:
        ---
        ${dataSample}
        ---
        Your primary goal is to help the user explore and understand this data. Follow these rules:
        1.  Answer Directly: Answer questions based *only* on the provided data.
        2.  Ask for Clarification: If a request is vague (e.g., "show totals"), ask a clarifying question (e.g., "Do you mean total sales value, total products sold, or number of invoices?").
        3.  Be Proactive: After answering, suggest a related analysis (e.g., if asked for the top product, suggest analyzing its top customer).
        4.  Generate Visualizations: If a query can be visualized (bar, pie, line, scatter), you MUST provide the chart data in the 'chartData' field. Otherwise, set 'chartData' to null. Include axis labels (xAxisLabel, yAxisLabel) where appropriate.
        5.  Language and Format: Always respond in Brazilian Portuguese. Your entire response must be a single, valid JSON object, adhering to the required schema.
    `;

  return ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: chatResponseSchema,
    },
  });
};

export async function* sendMessageStream(chat: Chat, message: string): AsyncGenerator<string> {
  if (!chat) {
    throw new Error('Chat not initialized.');
  }

  try {
    const stream = await chat.sendMessageStream({ message });
    for await (const chunk of stream) {
      yield chunk.text;
    }
  } catch (e) {
    console.error('Error during streaming or parsing:', e);
    throw new Error('Desculpe, ocorreu um erro ao processar sua solicitação. A IA pode ter retornado uma resposta inválida.');
  }
}
