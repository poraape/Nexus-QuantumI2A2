import { createChatSession, sendChatMessage, ResponseSchema, ChatSessionHandle } from './llmService';

const chatResponseSchema: ResponseSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', description: "Resposta textual para o usuário." },
    chartData: {
      type: ['object', 'null'],
      description: 'Dados para visualização opcional.',
      properties: {
        type: { type: 'string', enum: ['bar', 'pie', 'line', 'scatter'] },
        title: { type: 'string' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
              x: { type: ['number', 'null'] },
            },
            required: ['label', 'value'],
          },
        },
        xAxisLabel: { type: ['string', 'null'] },
        yAxisLabel: { type: ['string', 'null'] },
      },
      nullable: true,
    },
  },
  required: ['text'],
};

export type ChatSession = ChatSessionHandle;

export async function startChat(
  dataSample: string,
  aggregatedMetrics?: Record<string, any>,
): Promise<ChatSession> {
  const systemInstruction = `
        Você é um assistente especialista em análise fiscal.
        Use as métricas agregadas como fonte de verdade para totais e utilize a amostra de dados para perguntas detalhadas.
        Após cada resposta, sugira uma análise relacionada e forneça dados de gráfico quando apropriado.
        Métricas agregadas disponíveis:\n${JSON.stringify(aggregatedMetrics ?? {}, null, 2)}\n
        Amostra de dados (CSV):\n${dataSample}\n
    `;
  return createChatSession('gemini-2.0-flash', systemInstruction, chatResponseSchema);
}

export async function requestChatMessage(
  session: ChatSession,
  message: string,
): Promise<Record<string, any>> {
  return sendChatMessage(session, message);
}
