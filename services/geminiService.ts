import { GoogleGenAI, Chat, Type } from "@google/genai";
import { logger } from "./logger";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export type ResponseSchema = {
    type: Type;
    properties?: Record<string, any>;
    items?: Record<string, any>;
    required?: string[];
    description?: string;
    enum?: string[];
    nullable?: boolean;
};

export async function generateJSON<T = any>(
    model: string,
    prompt: string,
    schema?: ResponseSchema
): Promise<T> {
    try {
        const response = await ai.models.generateContent({
            model,
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: prompt,
                        },
                    ],
                },
            ],
            config: schema
                ? { responseMimeType: "application/json", responseSchema: schema as any }
                : {},
        });

        const raw = (
            response?.text ??
            response?.candidates?.[0]?.content?.parts?.[0]?.text ??
            ""
        ).trim();

        if (!raw) {
            throw new Error("Resposta vazia do LLM");
        }

        const jsonPayload = raw.match(/\{[\s\S]*\}$/)?.[0] ?? raw;
        return JSON.parse(jsonPayload) as T;
    } catch (e) {
        logger.log("geminiService", "ERROR", "generateJSON falhou", { error: e });
        throw e;
    }
}

export function createChatSession(
    model: string,
    systemInstruction: string,
    schema?: ResponseSchema
): Chat {
    return ai.chats.create({
        model,
        config: {
            systemInstruction,
            ...(schema
                ? { responseMimeType: "application/json", responseSchema: schema as any }
                : {}),
        },
    });
}

export async function* streamChatMessage(chat: Chat, message: string): AsyncGenerator<string> {
    if (!chat) {
        throw new Error("Chat not initialized.");
    }

    try {
        const stream = await chat.sendMessageStream({ message });
        for await (const chunk of stream) {
            yield chunk.text;
        }
    } catch (e) {
        logger.log("geminiService", "ERROR", "Falha durante o streaming da resposta do chat.", { error: e });
        console.error("Error during streaming chat:", e);
        throw new Error("Desculpe, ocorreu um erro ao processar sua solicitação de chat.");
    }
}
