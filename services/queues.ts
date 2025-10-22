import { Queue, QueueEvents, Worker, JobsOptions } from 'bullmq';
import type { IntegrationExportJobPayload, IntegrationJobPayload } from '../types';
import { integrationStateStore } from './integrationStateStore';

const connection = {
    connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },
};

export const importQueue = new Queue<IntegrationJobPayload>('erp-import-queue', connection);
export const exportQueue = new Queue<IntegrationExportJobPayload>('erp-export-queue', connection);

export const importQueueEvents = new QueueEvents('erp-import-queue', connection);
export const exportQueueEvents = new QueueEvents('erp-export-queue', connection);

export type IntegrationWorkerHandler<T extends IntegrationJobPayload> = (job: T) => Promise<void>;

export const registerImportWorker = (handler: IntegrationWorkerHandler<IntegrationJobPayload>) =>
    new Worker<IntegrationJobPayload>('erp-import-queue', async (job) => {
        const payload = job.data;
        await handler(payload);
        await integrationStateStore.decrementPending(payload.erp);
    }, connection);

export const registerExportWorker = (handler: IntegrationWorkerHandler<IntegrationExportJobPayload>) =>
    new Worker<IntegrationExportJobPayload>('erp-export-queue', async (job) => {
        const payload = job.data;
        await handler(payload);
        await integrationStateStore.decrementPending(payload.erp);
    }, connection);

export const enqueueImportJob = async (payload: IntegrationJobPayload, options: JobsOptions = {}) => {
    await integrationStateStore.incrementPending(payload.erp);
    await importQueue.add('import', payload, options);
};

export const enqueueExportJob = async (payload: IntegrationExportJobPayload, options: JobsOptions = {}) => {
    await integrationStateStore.incrementPending(payload.erp);
    await exportQueue.add('export', payload, options);
};

