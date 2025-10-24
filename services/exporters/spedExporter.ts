import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import dayjs from 'dayjs';
import type { IntegrationJobPayload } from '../../types';
import { integrationStateStore } from '../integrationStateStore';

export interface SpedExporterConfig {
    layout: 'EFD-ICMS' | 'EFD-Contribuições';
}

export const runSpedExport = async (
    payload: IntegrationJobPayload,
    config: SpedExporterConfig,
    documents: Record<string, unknown>[],
): Promise<{ filePath: string }> => {
    const filePath = join(tmpdir(), `sped-${payload.erp.toLowerCase()}-${dayjs().format('YYYYMMDD-HHmmss')}.txt`);

    try {
        const stream = createWriteStream(filePath);
        stream.write(`|0000|LECD|${config.layout}|${dayjs().format('YYYYMMDD')}|\n`);
        documents.forEach((doc, index) => {
            stream.write(`|C100|${index + 1}|${JSON.stringify(doc)}|\n`);
        });
        stream.end();

        await integrationStateStore.recordRun({
            erp: payload.erp,
            action: 'export',
            status: 'success',
            message: `Arquivo SPED gerado com ${documents.length} lançamentos`,
            payload: { ...payload, layout: config.layout, count: documents.length, filePath },
        });

        return { filePath };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha desconhecida ao gerar SPED';
        await integrationStateStore.recordRun({
            erp: payload.erp,
            action: 'export',
            status: 'error',
            message,
        });
        throw error;
    }
};

