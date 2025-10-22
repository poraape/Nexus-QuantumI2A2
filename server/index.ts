import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import type { Request, Response } from 'express';
import { ErpIntegrator } from '../agents/erpIntegrator';
import { bootstrapPostgres } from '../services/postgresClient';
import { integrationStateStore } from '../services/integrationStateStore';
import { enqueueExportJob, registerExportWorker, registerImportWorker } from '../services/queues';
import type { IntegrationJobPayload, IntegrationExportJobPayload } from '../types';

const app = express();
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

