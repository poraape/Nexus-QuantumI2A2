import EventEmitter from 'events';
import cron from 'node-cron';
import dayjs from 'dayjs';
import type { IntegrationConfig, IntegrationJobPayload, IntegrationWebhookPayload, IntegrationChannel, IntegrationExportJobPayload } from '../types';
import { integrationStateStore } from '../services/integrationStateStore';
import { enqueueExportJob, enqueueImportJob } from '../services/queues';
import { runNfePublicImport } from '../services/importers/nfePublicImporter';
import { runSpedExport } from '../services/exporters/spedExporter';

export type ErpProvider = 'tiny' | 'bling' | 'contaAzul';

export interface ErpIntegratorOptions {
    config: IntegrationConfig;
}

interface SyncContext {
    erp: IntegrationChannel;
    since?: string;
    companyId: string;
}

abstract class BaseErpConnector {
    abstract readonly provider: ErpProvider;

    constructor(protected readonly config: IntegrationConfig[ErpProvider]) {}

    abstract fetchUpdates(context: SyncContext): Promise<Record<string, unknown>[]>;
    abstract pushDocuments(context: SyncContext, documents: Record<string, unknown>[]): Promise<void>;
}

class TinyConnector extends BaseErpConnector {
    readonly provider: ErpProvider = 'tiny';

    async fetchUpdates(context: SyncContext): Promise<Record<string, unknown>[]> {
        const { apiKey, baseUrl } = this.config;
        const url = new URL(`${baseUrl}/notas`);
        url.searchParams.set('token', apiKey);
        url.searchParams.set('formato', 'json');
        if (context.since) url.searchParams.set('dataInicio', context.since);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Tiny API error: ${response.status}`);
        }
        const data = await response.json();
        return data?.retorno?.notas ?? [];
    }

    async pushDocuments(context: SyncContext, documents: Record<string, unknown>[]): Promise<void> {
        const { apiKey, baseUrl } = this.config;
        const response = await fetch(`${baseUrl}/sped`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: apiKey, companyId: context.companyId, documents }),
        });
        if (!response.ok) {
            throw new Error(`Tiny export error: ${response.status}`);
        }
    }
}

class BlingConnector extends BaseErpConnector {
    readonly provider: ErpProvider = 'bling';

    async fetchUpdates(context: SyncContext): Promise<Record<string, unknown>[]> {
        const { apiKey, baseUrl } = this.config;
        const url = new URL(`${baseUrl}/nfe`);
        if (context.since) url.searchParams.set('dataEmissaoInicial', context.since);
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) {
            throw new Error(`Bling API error: ${response.status}`);
        }
        const data = await response.json();
        return data?.data ?? [];
    }

    async pushDocuments(context: SyncContext, documents: Record<string, unknown>[]): Promise<void> {
        const { apiKey, baseUrl } = this.config;
        const response = await fetch(`${baseUrl}/sped/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ documents }),
        });
        if (!response.ok) {
            throw new Error(`Bling export error: ${response.status}`);
        }
    }
}

class ContaAzulConnector extends BaseErpConnector {
    readonly provider: ErpProvider = 'contaAzul';

    async fetchUpdates(context: SyncContext): Promise<Record<string, unknown>[]> {
        const { apiKey, baseUrl } = this.config;
        const url = new URL(`${baseUrl}/v1/invoices`);
        if (context.since) url.searchParams.set('updated_after', context.since);
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) {
            throw new Error(`Conta Azul API error: ${response.status}`);
        }
        const data = await response.json();
        return data?.data ?? [];
    }

    async pushDocuments(context: SyncContext, documents: Record<string, unknown>[]): Promise<void> {
        const { apiKey, baseUrl } = this.config;
        const response = await fetch(`${baseUrl}/v1/sped`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ documents }),
        });
        if (!response.ok) {
            throw new Error(`Conta Azul export error: ${response.status}`);
        }
    }
}

const connectorFactory: Record<ErpProvider, new (config: IntegrationConfig[ErpProvider]) => BaseErpConnector> = {
    tiny: TinyConnector,
    bling: BlingConnector,
    contaAzul: ContaAzulConnector,
};

const providerToChannel: Record<ErpProvider, IntegrationChannel> = {
    tiny: 'TINY',
    bling: 'BLING',
    contaAzul: 'CONTA_AZUL',
};

export class ErpIntegrator extends EventEmitter {
    private connectors: Map<ErpProvider, BaseErpConnector> = new Map();
    private cronJobs: cron.ScheduledTask[] = [];

    constructor(private readonly options: ErpIntegratorOptions) {
        super();
        this.initializeConnectors();
        this.scheduleSyncs();
    }

    private channelToProvider(channel: IntegrationChannel): ErpProvider | undefined {
        return (Object.keys(providerToChannel) as ErpProvider[]).find((provider) => providerToChannel[provider] === channel);
    }

    private initializeConnectors() {
        (Object.keys(this.options.config) as ErpProvider[]).forEach((provider) => {
            const config = this.options.config[provider];
            if (!config) return;
            this.connectors.set(provider, new connectorFactory[provider](config));
        });
    }

    private scheduleSyncs() {
        this.cronJobs.forEach((job) => job.stop());
        this.cronJobs = [];

        this.connectors.forEach((connector, provider) => {
            const schedule = this.options.config[provider]?.schedule ?? '0 * * * *';
            const task = cron.schedule(schedule, () => {
                void this.enqueueImport({
                    erp: providerToChannel[provider],
                    companyId: this.options.config[provider].companyId,
                });
            });
            this.cronJobs.push(task);
        });
    }

    async enqueueImport(payload: IntegrationJobPayload) {
        await integrationStateStore.recordRun({
            erp: payload.erp,
            action: 'import',
            status: 'queued',
            payload,
        });
        await enqueueImportJob({ ...payload, requestedBy: payload.requestedBy ?? 'scheduler', since: payload.since ?? dayjs().subtract(1, 'day').toISOString() });
        this.emit('jobQueued', payload);
    }

    async enqueueExport(payload: IntegrationJobPayload) {
        if (!payload.documents || payload.documents.length === 0) {
            throw new Error('Export job requires at least one document.');
        }
        await integrationStateStore.recordRun({
            erp: payload.erp,
            action: 'export',
            status: 'queued',
            payload,
        });
        await enqueueExportJob({
            ...payload,
            requestedBy: payload.requestedBy ?? 'scheduler',
            documents: payload.documents,
        });
        this.emit('jobQueued', payload);
    }

    async handleWebhook(data: IntegrationWebhookPayload) {
        const payload: IntegrationJobPayload = {
            erp: data.erp,
            companyId: data.companyId,
            requestedBy: 'webhook',
            since: data.since,
            metadata: data.metadata,
        };

        if (data.kind === 'import') {
            await this.enqueueImport(payload);
        } else {
            if (!data.documents || data.documents.length === 0) {
                throw new Error('Webhook export payload missing documents.');
            }
            await this.enqueueExport({ ...payload, documents: data.documents });
        }
    }

    async processImportJob(job: IntegrationJobPayload) {
        const provider = this.channelToProvider(job.erp);
        if (!provider) throw new Error(`ERP provider not configured for channel ${job.erp}`);
        const connector = this.connectors.get(provider);
        if (!connector) throw new Error(`Connector not found for provider ${provider}`);

        const documents = await connector.fetchUpdates({
            erp: job.erp,
            companyId: job.companyId,
            since: job.since,
        });

        const nfeResult = await runNfePublicImport(job, {
            endpoint: this.options.config[provider].publicNfeEndpoint,
            token: this.options.config[provider].publicNfeToken,
        });

        this.emit('documentsImported', { erp: job.erp, documents, nfeDocuments: nfeResult.documents });
        return { documents, nfeDocuments: nfeResult.documents };
    }

    async processExportJob(job: IntegrationExportJobPayload) {
        const provider = this.channelToProvider(job.erp);
        if (!provider) throw new Error(`ERP provider not configured for channel ${job.erp}`);
        const connector = this.connectors.get(provider);
        if (!connector) throw new Error(`Connector not found for provider ${provider}`);

        if (!job.documents || job.documents.length === 0) {
            throw new Error('Export job missing documents payload.');
        }

        await runSpedExport(job, { layout: this.options.config[provider].spedLayout }, job.documents);
        await connector.pushDocuments({
            erp: job.erp,
            companyId: job.companyId,
            since: job.since,
        }, job.documents);

        this.emit('documentsExported', { erp: job.erp, count: job.documents.length });
    }
}

