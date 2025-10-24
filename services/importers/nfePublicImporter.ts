import dayjs from 'dayjs';
import { XMLParser } from 'fast-xml-parser';
import { integrationStateStore } from '../integrationStateStore';
import type { IntegrationJobPayload } from '../../types';

export interface NfePublicImporterConfig {
    endpoint: string;
    token?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

export const runNfePublicImport = async (
    payload: IntegrationJobPayload,
    config: NfePublicImporterConfig,
): Promise<{ documents: Record<string, unknown>[] }> => {
    try {
        await integrationStateStore.recordRun({
            erp: payload.erp,
            action: 'import',
            status: 'running',
            payload: { ...payload },
        });

        const url = new URL(config.endpoint);
        url.searchParams.set('since', payload.since ?? dayjs().subtract(1, 'day').toISOString());
        url.searchParams.set('companyId', payload.companyId);

        const response = await fetch(url, {
            headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined,
        });

        if (!response.ok) {
            throw new Error(`NFe público indisponível: ${response.status}`);
        }

        const body = await response.json();
        const rawDocuments: string[] = body?.documents ?? [];
        const documents = rawDocuments.map((xml: string) => parser.parse(xml));

        await integrationStateStore.recordRun({
            erp: payload.erp,
            action: 'import',
            status: 'success',
            timestamp: new Date(),
            message: `Importadas ${documents.length} NFes públicas`,
            payload: { ...payload, count: documents.length },
        });

        return { documents };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha desconhecida ao importar NFes';
        await integrationStateStore.recordRun({
            erp: payload.erp,
            action: 'import',
            status: 'error',
            message,
        });
        throw error;
    }
};

