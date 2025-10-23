import { logger } from "./logger";
import { telemetry } from "./telemetry";
import { executeWithResilience } from "./resilience";

const DEFAULT_BROWSER_PROXY_PATH = "/api/llm/proxy";
const DEFAULT_SERVER_PROXY_URL = "http://localhost:8000/api/llm/proxy";

type ProxyChatStream = AsyncGenerator<{ text?: string }>; 

class ProxyChatSession {
    readonly sessionId: string;
    private readonly baseUrl: string;

    constructor(sessionId: string, baseUrl: string) {
        this.sessionId = sessionId;
        this.baseUrl = baseUrl;
    }

    async sendMessageStream(payload: { message: string }): Promise<ProxyChatStream> {
        return streamFromProxy(`${this.baseUrl}/chat/sessions/${this.sessionId}/stream`, payload.message);
    }
}

function resolveProxyBaseUrl(): string {
    if (typeof window !== "undefined") {
        const env = (import.meta as any)?.env;
        const configured = env?.VITE_GEMINI_PROXY_URL ?? DEFAULT_BROWSER_PROXY_PATH;
        return configured.replace(/\/$/, "");
    }
    if (typeof process !== "undefined" && process.env?.GEMINI_PROXY_URL) {
        return process.env.GEMINI_PROXY_URL.replace(/\/$/, "");
    }
    if (typeof process !== "undefined" && process.env?.VITE_BACKEND_URL) {
        return `${process.env.VITE_BACKEND_URL.replace(/\/$/, "")}${DEFAULT_BROWSER_PROXY_PATH}`;
    }
    return DEFAULT_SERVER_PROXY_URL;
}

const PROXY_BASE_URL = resolveProxyBaseUrl();

async function proxyRequest<T>(path: string, payload: unknown, correlationId?: string): Promise<T> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (correlationId) {
        headers.set("X-Correlation-Id", correlationId);
    }

    const response = await fetch(`${PROXY_BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(errorBody || "Falha ao comunicar com o proxy Gemini.");
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
        return response.json() as Promise<T>;
    }

    const text = await response.text();
    return JSON.parse(text) as T;
}

async function streamFromProxy(url: string, message: string): Promise<ProxyChatStream> {
    const response = await fetch(url, {
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message }),
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(errorBody || "Falha ao iniciar o streaming com o proxy Gemini.");
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("Resposta de streaming inválida do proxy Gemini.");
    }

    const decoder = new TextDecoder();

    async function* iterator(): ProxyChatStream {
        let buffer = "";
        let streamFinished = false;
        try {
            while (!streamFinished) {
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer.trim().length > 0) {
                        yield { text: buffer };
                    }
                    streamFinished = true;
                    continue;
                }
                buffer += decoder.decode(value, { stream: true });
                let newlineIndex = buffer.indexOf("\n");
                while (newlineIndex !== -1) {
                    const chunk = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    if (chunk.trim().length > 0) {
                        yield { text: chunk.trim() };
                    }
                    newlineIndex = buffer.indexOf("\n");
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    return iterator();
}

// A type for the schema definition to avoid using `any`
export type ResponseSchema = Record<string, any>;

export type Chat = ProxyChatSession;

/**
 * Generates content from the Gemini model with a specified JSON schema for the response.
 * @param model The Gemini model to use (e.g., 'gemini-2.5-flash').
 * @param prompt The user prompt.
 * @param schema The JSON schema for the expected response.
 * @returns A promise that resolves to the parsed JSON object.
 */
export async function generateJSON<T = any>(
    model: string,
    prompt: string,
    schema: ResponseSchema,
    options?: { correlationId?: string; attributes?: Record<string, any> }
): Promise<T> {
    const correlationId = options?.correlationId || telemetry.createCorrelationId('llm');
    const attributes = { model, ...options?.attributes };
    try {
        const response = await executeWithResilience('llm', 'gemini.generateJSON', async () => {
            return proxyRequest<{ text: string }>(
                '/generate-json',
                { model, prompt, schema },
                correlationId
            );
        }, {
            correlationId,
            attributes,
            maxAttempts: 4,
        });

        const text = response.text;
        if (!text) {
             throw new Error("A IA retornou uma resposta vazia.");
        }

        logger.log('geminiService', 'INFO', 'Resposta do modelo recebida com sucesso.', attributes, { correlationId, scope: 'llm' });
        return JSON.parse(text) as T;

    } catch (e) {
        logger.log('geminiService', 'ERROR', `Falha na geração de JSON com o modelo ${model}.`, { error: e, ...attributes }, { correlationId, scope: 'llm' });
        console.error("Gemini JSON generation failed:", e);
        if (e instanceof SyntaxError || (e instanceof Error && e.message.toLowerCase().includes('json'))) {
             throw new Error('A resposta da IA não estava em um formato JSON válido.');
        }
        throw new Error('Ocorreu um erro na comunicação com a IA.');
    }
}

/**
 * Creates a new chat session with a system instruction and a JSON schema for responses.
 * @param model The Gemini model to use.
 * @param systemInstruction The system-level instructions for the chat bot.
 * @param schema The JSON schema for all chat responses.
 * @returns A Chat instance.
 */
export async function createChatSession(
    model: string,
    systemInstruction: string,
    schema: ResponseSchema
): Promise<Chat> {
    const correlationId = telemetry.createCorrelationId('llm');
    const payload = { model, systemInstruction, schema };
    const response = await executeWithResilience('llm', 'gemini.createChatSession', async () => {
        return proxyRequest<{ sessionId: string }>(
            '/chat/sessions',
            payload,
            correlationId
        );
    }, {
        correlationId,
        attributes: payload,
        maxAttempts: 3,
    });

    logger.log('geminiService', 'INFO', 'Sessão de chat criada com sucesso.', { model }, { correlationId, scope: 'llm' });
    return new ProxyChatSession(response.sessionId, PROXY_BASE_URL);
}

/**
 * Sends a message in a chat and streams the response.
 * @param chat The Chat instance.
 * @param message The user's message.
 * @returns An async generator that yields text chunks of the response.
 */
export async function* streamChatMessage(chat: Chat, message: string, correlationId?: string): AsyncGenerator<string> {
    if (!chat) {
        throw new Error('Chat not initialized.');
    }

    const cid = correlationId || telemetry.createCorrelationId('llm');
    try {
        const stream = await executeWithResilience('llm', 'gemini.streamChat', async () => chat.sendMessageStream({ message }), {
            correlationId: cid,
            attributes: { messageLength: message.length },
            maxAttempts: 3,
        });
        for await (const chunk of stream) {
            if (chunk?.text) {
                yield chunk.text;
            }
        }
        logger.log('geminiService', 'INFO', 'Streaming concluído com sucesso.', { messageLength: message.length }, { correlationId: cid, scope: 'llm' });
    } catch (e) {
        logger.log('geminiService', 'ERROR', 'Falha durante o streaming da resposta do chat.', { error: e }, { correlationId: cid, scope: 'llm' });
        console.error('Error during streaming chat:', e);
        throw new Error('Desculpe, ocorreu um erro ao processar sua solicitação de chat.');
    }
}
