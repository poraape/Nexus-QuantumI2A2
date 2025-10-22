import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI, type Chat } from '@google/genai';
import { ErpIntegrator } from '../agents/erpIntegrator';
import { bootstrapPostgres } from '../services/postgresClient';
import { integrationStateStore } from '../services/integrationStateStore';
import { enqueueExportJob, registerExportWorker, registerImportWorker } from '../services/queues';
import type { IntegrationJobPayload, IntegrationExportJobPayload } from '../types';

export const app = express();
app.use(cors());
app.use(bodyParser.json());

const integrator = new ErpIntegrator({
    config: {
        tiny: {
            apiKey: process.env.TINY_API_KEY ?? '',
            baseUrl: process.env.TINY_BASE_URL ?? 'https://api.tiny.com.br',
            companyId: process.env.TINY_COMPANY_ID ?? 'default',
            schedule: process.env.TINY_CRON ?? '*/30 * * * *',
            publicNfeEndpoint: process.env.NFE_PUBLIC_ENDPOINT ?? 'https://public.nfe/api',
            publicNfeToken: process.env.NFE_PUBLIC_TOKEN,
            spedLayout: 'EFD-ICMS',
        },
        bling: {
            apiKey: process.env.BLING_API_KEY ?? '',
            baseUrl: process.env.BLING_BASE_URL ?? 'https://www.bling.com.br/Api/v3',
            companyId: process.env.BLING_COMPANY_ID ?? 'default',
            schedule: process.env.BLING_CRON ?? '*/45 * * * *',
            publicNfeEndpoint: process.env.NFE_PUBLIC_ENDPOINT ?? 'https://public.nfe/api',
            publicNfeToken: process.env.NFE_PUBLIC_TOKEN,
            spedLayout: 'EFD-Contribuições',
        },
        contaAzul: {
            apiKey: process.env.CONTA_AZUL_API_KEY ?? '',
            baseUrl: process.env.CONTA_AZUL_BASE_URL ?? 'https://api.contaazul.com/v1',
            companyId: process.env.CONTA_AZUL_COMPANY_ID ?? 'default',
            schedule: process.env.CONTA_AZUL_CRON ?? '0 * * * *',
            publicNfeEndpoint: process.env.NFE_PUBLIC_ENDPOINT ?? 'https://public.nfe/api',
            publicNfeToken: process.env.NFE_PUBLIC_TOKEN,
            spedLayout: 'EFD-ICMS',
        },
    },
});

registerImportWorker(async (job) => {
    await integrationStateStore.recordRun({
        erp: job.erp,
        action: 'import',
        status: 'running',
        payload: job,
    });
    try {
        const result = await integrator.processImportJob(job);
        await integrationStateStore.recordRun({
            erp: job.erp,
            action: 'import',
            status: 'success',
            payload: { ...job, resultCount: result.documents.length },
        });
    } catch (error) {
        await integrationStateStore.recordRun({
            erp: job.erp,
            action: 'import',
            status: 'error',
            message: error instanceof Error ? error.message : 'Falha desconhecida ao importar',
            payload: job,
        });
        throw error;
    }
});

registerExportWorker(async (job) => {
    await integrationStateStore.recordRun({
        erp: job.erp,
        action: 'export',
        status: 'running',
        payload: job,
    });
    try {
        if (!('documents' in job) || !job.documents) {
            throw new Error('Export job requires documents array');
        }
        await integrator.processExportJob(job as IntegrationExportJobPayload);
        await integrationStateStore.recordRun({
            erp: job.erp,
            action: 'export',
            status: 'success',
            payload: { ...job, count: job.documents.length },
        });
    } catch (error) {
        await integrationStateStore.recordRun({
            erp: job.erp,
            action: 'export',
            status: 'error',
            message: error instanceof Error ? error.message : 'Falha desconhecida ao exportar',
            payload: job,
        });
        throw error;
    }
});

app.get('/api/integrations/status', async (_req: Request, res: Response) => {
    const statuses = await integrationStateStore.getStatuses();
    const history = await integrationStateStore.getHistory();
    res.json({ statuses, history });
});

app.post('/api/integrations/:erp/import', async (req: Request, res: Response) => {
    const { erp } = req.params;
    const payload = req.body as IntegrationJobPayload;
    const job: IntegrationJobPayload = {
        ...payload,
        erp: erp.toUpperCase() as IntegrationJobPayload['erp'],
        requestedBy: req.body?.requestedBy ?? 'api',
    };
    await integrator.enqueueImport(job);
    res.status(202).json({ status: 'queued' });
});

app.post('/api/integrations/:erp/export', async (req: Request, res: Response) => {
    const { erp } = req.params;
    const payload = req.body as IntegrationExportJobPayload | (IntegrationJobPayload & { documents?: Record<string, unknown>[] });
    if (!payload.documents) {
        res.status(400).json({ error: 'documents array is required' });
        return;
    }
    const job: IntegrationExportJobPayload = {
        ...payload,
        erp: erp.toUpperCase() as IntegrationJobPayload['erp'],
        requestedBy: req.body?.requestedBy ?? 'api',
        documents: payload.documents,
    };
    await integrationStateStore.recordRun({
        erp: job.erp,
        action: 'export',
        status: 'queued',
        payload: job,
    });
    await enqueueExportJob(job);
    res.status(202).json({ status: 'queued' });
});

app.post('/api/integrations/webhook', async (req: Request, res: Response) => {
    await integrator.handleWebhook(req.body);
    res.status(202).json({ status: 'accepted' });
});

let geminiClient: GoogleGenAI | null = null;
const chatSessions = new Map<string, Chat>();

const ensureGeminiClient = (): GoogleGenAI => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured');
    }
    if (!geminiClient) {
        geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return geminiClient;
};

export const resetGeminiProxy = () => {
    geminiClient = null;
    chatSessions.clear();
};

app.post('/api/llm/proxy/generate-json', async (req: Request, res: Response) => {
    let client: GoogleGenAI;
    try {
        client = ensureGeminiClient();
    } catch (error) {
        res.status(500).send((error as Error).message);
        return;
    }

    const { model, prompt, schema } = req.body ?? {};
    try {
        const response = await client.models.generateContent({
            model,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: schema,
            },
        });
        res.json({ text: response.text });
    } catch (error) {
        res.status(502).send((error as Error).message);
    }
});

app.post('/api/llm/proxy/chat/sessions', async (req: Request, res: Response) => {
    let client: GoogleGenAI;
    try {
        client = ensureGeminiClient();
    } catch (error) {
        res.status(500).send((error as Error).message);
        return;
    }

    const { model, systemInstruction, schema } = req.body ?? {};
    try {
        const chat = client.chats.create({
            model,
            config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: schema,
            },
        });
        const sessionId = randomUUID();
        chatSessions.set(sessionId, chat);
        res.json({ sessionId });
    } catch (error) {
        res.status(502).send((error as Error).message);
    }
});

app.post('/api/llm/proxy/chat/sessions/:sessionId/stream', async (req: Request, res: Response) => {
    const chat = chatSessions.get(req.params.sessionId);
    if (!chat) {
        res.status(404).send('Chat session not found');
        return;
    }

    try {
        const stream = await chat.sendMessageStream({ message: req.body?.message ?? '' });
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');
        for await (const chunk of stream) {
            if (chunk?.text) {
                res.write(`${chunk.text}\n`);
            }
        }
        res.end();
    } catch (error) {
        if (!res.headersSent) {
            res.status(502).send((error as Error).message);
        }
    }
});

export const startServer = async () => {
    await bootstrapPostgres();
    const port = Number(process.env.PORT ?? 4000);
    return new Promise((resolve) => {
        const server = app.listen(port, () => {
            // eslint-disable-next-line no-console
            console.log(`Integration server running on port ${port}`);
            resolve(server);
        });
    });
};

if (process.env.NODE_ENV !== 'test') {
    void startServer();
}

