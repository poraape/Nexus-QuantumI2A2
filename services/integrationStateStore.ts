import { v4 as uuid } from 'uuid';
import dayjs from 'dayjs';
import type { IntegrationHistoryEntry, IntegrationStatus } from '../types';
import { postgresClient } from './postgresClient';

export class IntegrationStateStore {
    async recordRun(entry: Omit<IntegrationHistoryEntry, 'id' | 'timestamp'> & { timestamp?: string | Date }): Promise<void> {
        const id = uuid();
        const timestamp = entry.timestamp ? dayjs(entry.timestamp).toISOString() : dayjs().toISOString();

        await postgresClient.query(
            `INSERT INTO integration_runs (id, erp, action, status, message, payload, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, entry.erp, entry.action, entry.status, entry.message ?? null, entry.payload ?? null, timestamp],
        );

        const pendingJobs = entry.pendingJobs ?? null;

        await postgresClient.query(
            `INSERT INTO integration_state (erp, last_run_at, last_success_at, last_error, pending_jobs, last_payload, updated_at)
             VALUES ($1, $2, CASE WHEN $3 = 'success' THEN $2 ELSE NULL END, CASE WHEN $3 = 'error' THEN $4 ELSE NULL END,
                     COALESCE($5, 0), $6, NOW())
             ON CONFLICT (erp)
             DO UPDATE SET
                last_run_at = EXCLUDED.last_run_at,
                last_success_at = CASE WHEN EXCLUDED.last_success_at IS NOT NULL THEN EXCLUDED.last_success_at ELSE integration_state.last_success_at END,
                last_error = CASE WHEN $3 = 'error' THEN EXCLUDED.last_error WHEN $3 = 'success' THEN NULL ELSE integration_state.last_error END,
                pending_jobs = CASE WHEN EXCLUDED.pending_jobs IS NULL THEN integration_state.pending_jobs ELSE EXCLUDED.pending_jobs END,
                last_payload = EXCLUDED.last_payload,
                updated_at = NOW();`,
            [
                entry.erp,
                timestamp,
                entry.status,
                entry.message ?? null,
                pendingJobs,
                entry.payload ?? null,
            ],
        );
    }

    async incrementPending(erp: IntegrationStatus['erp']): Promise<void> {
        await postgresClient.query(
            `INSERT INTO integration_state (erp, pending_jobs)
             VALUES ($1, 1)
             ON CONFLICT (erp) DO UPDATE SET pending_jobs = integration_state.pending_jobs + 1, updated_at = NOW();`,
            [erp],
        );
    }

    async decrementPending(erp: IntegrationStatus['erp']): Promise<void> {
        await postgresClient.query(
            `UPDATE integration_state SET pending_jobs = GREATEST(pending_jobs - 1, 0), updated_at = NOW() WHERE erp = $1;`,
            [erp],
        );
    }

    async getStatuses(): Promise<IntegrationStatus[]> {
        const result = await postgresClient.query<IntegrationStatus & { last_payload: any }>(
            `SELECT erp, last_run_at AS "lastRunAt", last_success_at AS "lastSuccessAt", last_error AS "lastError",
                    pending_jobs AS "pendingJobs", updated_at AS "updatedAt", last_payload
             FROM integration_state
             ORDER BY erp ASC;`,
        );

        return result.rows.map((row) => ({
            ...row,
            lastPayload: row.last_payload ?? undefined,
            state: row.lastError ? 'error' : row.pendingJobs > 0 ? 'running' : 'idle',
        }));
    }

    async getHistory(erp?: IntegrationStatus['erp']): Promise<IntegrationHistoryEntry[]> {
        const result = await postgresClient.query<IntegrationHistoryEntry & { created_at: string }>(
            `SELECT id, erp, action, status, message, payload, created_at
             FROM integration_runs
             ${erp ? 'WHERE erp = $1' : ''}
             ORDER BY created_at DESC
             LIMIT 200;`,
            erp ? [erp] : [],
        );

        return result.rows.map((row) => ({
            ...row,
            timestamp: row.created_at,
        }));
    }
}

export const integrationStateStore = new IntegrationStateStore();

