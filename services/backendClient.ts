import { ensureSession } from './authService';
import type { AuditReport, ClassificationResult } from '../types';
import type { AgentStateContract, JobStatus } from '../src/types/contracts';

export type BackendAgentStatus = AgentStateContract['status'];
export type BackendAgentState = AgentStateContract;

export type AnalysisJobResponse = {
    jobId: string;
    status?: JobStatus | string;
    agentStates?: Record<string, BackendAgentState | undefined>;
    error?: string | null;
    result?: AuditReport | null;
    createdAt?: string;
    updatedAt?: string;
};

export type JobStateUpdateHandler = (update: AnalysisJobResponse) => void;
export type JobStateErrorHandler = (error: Event | Error) => void;

export interface JobStateSubscriptionOptions {
    onUpdate: JobStateUpdateHandler;
    onError?: JobStateErrorHandler;
    signal?: AbortSignal;
}

export interface ClassificationCorrectionRecord {
    documentName: string;
    operationType: ClassificationResult['operationType'];
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface ClassificationCorrectionsResponse {
    jobId: string;
    corrections: ClassificationCorrectionRecord[];
}

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

const withBase = (path: string) => `${API_BASE_URL.replace(/\/$/, '')}${path}`;

export async function startAnalysis(files: File[], webhookUrl?: string): Promise<AnalysisJobResponse> {
    await ensureSession();
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (webhookUrl) {
        formData.append('webhook_url', webhookUrl);
    }

    const response = await fetch(withBase('/api/analysis'), {
        method: 'POST',
        body: formData,
        credentials: 'include',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao iniciar a análise.');
    }

    return (await response.json()) as AnalysisJobResponse;
}

export async function fetchAnalysis(jobId: string): Promise<AnalysisJobResponse> {
    await ensureSession();
    const response = await fetch(withBase(`/api/analysis/${jobId}`), {
        credentials: 'include',
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao buscar status da análise.');
    }
    return (await response.json()) as AnalysisJobResponse;
}

export async function fetchProgress(jobId: string): Promise<AnalysisJobResponse> {
    await ensureSession();
    const response = await fetch(withBase(`/api/analysis/${jobId}/progress`), {
        credentials: 'include',
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao obter progresso da análise.');
    }
    const payload = await response.json();
    const normalized: AnalysisJobResponse = {
        jobId: payload.jobId,
        status: payload.status,
        agentStates: payload.agentStates as Record<string, BackendAgentState | undefined> | undefined,
        error: payload.error,
    };

    if (Object.prototype.hasOwnProperty.call(payload, 'result')) {
        normalized.result = (payload.result ?? null) as AuditReport | null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'createdAt')) {
        normalized.createdAt = payload.createdAt;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'updatedAt')) {
        normalized.updatedAt = payload.updatedAt;
    }

    return normalized;
}

export async function fetchClassificationCorrections(jobId: string): Promise<ClassificationCorrectionsResponse> {
    await ensureSession();
    const response = await fetch(withBase(`/api/analysis/${jobId}/corrections`), {
        credentials: 'include',
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao carregar correções de classificação.');
    }
    return (await response.json()) as ClassificationCorrectionsResponse;
}

export async function persistClassificationCorrection(
    jobId: string,
    documentName: string,
    operationType: ClassificationResult['operationType'],
): Promise<ClassificationCorrectionsResponse> {
    await ensureSession();
    const response = await fetch(withBase(`/api/analysis/${jobId}/corrections`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentName, operationType }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao salvar a correção de classificação.');
    }
    return (await response.json()) as ClassificationCorrectionsResponse;
}

export function subscribeToJobState(jobId: string, options: JobStateSubscriptionOptions): () => void {
    const { onUpdate, onError, signal } = options;
    let stopped = false;
    let source: EventSource | null = null;
    let pollingTimer: ReturnType<typeof setInterval> | undefined;

    const stopPolling = () => {
        if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = undefined;
        }
    };

    const cleanup = () => {
        stopped = true;
        stopPolling();
        if (source) {
            source.close();
            source = null;
        }
        if (signal) {
            signal.removeEventListener('abort', cleanup);
        }
    };

    const deliverUpdate = (update: AnalysisJobResponse) => {
        onUpdate(update);
        const status = update.status?.toString().toLowerCase();
        if (status === 'completed' || status === 'failed') {
            cleanup();
        }
    };

    const adaptPayload = (data: unknown): AnalysisJobResponse | null => {
        if (!data || typeof data !== 'object') {
            return null;
        }

        const payload = data as Record<string, unknown>;
        const payloadJobId = typeof payload.jobId === 'string' ? payload.jobId : jobId;

        if (
            Object.prototype.hasOwnProperty.call(payload, 'agentStates') ||
            Object.prototype.hasOwnProperty.call(payload, 'status') ||
            Object.prototype.hasOwnProperty.call(payload, 'result')
        ) {
            const normalized: AnalysisJobResponse = {
                jobId: payloadJobId,
                status: payload.status as AnalysisJobResponse['status'],
                agentStates: payload.agentStates as Record<string, BackendAgentState | undefined> | undefined,
                error: (payload.error as string | null | undefined) ?? null,
                createdAt: payload.createdAt as string | undefined,
                updatedAt: payload.updatedAt as string | undefined,
            };

            if (Object.prototype.hasOwnProperty.call(payload, 'result')) {
                normalized.result = (payload.result ?? null) as AuditReport | null;
            }

            return normalized;
        }

        const agentName =
            typeof payload.agent === 'string'
                ? payload.agent
                : typeof payload.agentName === 'string'
                  ? payload.agentName
                  : undefined;
        const agentState =
            (payload.state as BackendAgentState | undefined) ??
            (payload.agentState as BackendAgentState | undefined) ??
            (payload.payload as BackendAgentState | undefined);

        if (agentName && agentState) {
            return {
                jobId: payloadJobId,
                status: payload.status as AnalysisJobResponse['status'],
                agentStates: { [agentName]: agentState },
                error: (payload.error as string | null | undefined) ?? null,
            };
        }

        return null;
    };

    const handleError = (error: Event | Error) => {
        if (onError) {
            onError(error);
        }
    };

    const startPolling = () => {
        if (stopped) {
            return;
        }
        stopPolling();
        const poll = async () => {
            if (stopped) {
                return;
            }
            try {
                const update = await fetchProgress(jobId);
                deliverUpdate(update);
            } catch (err) {
                handleError(err as Error);
            }
        };
        void poll();
        pollingTimer = setInterval(poll, 1000);
    };

    const processEventData = (event: MessageEvent<string>) => {
        try {
            const parsed = JSON.parse(event.data) as Record<string, unknown>;
            const normalized = adaptPayload(parsed);
            if (normalized) {
                deliverUpdate(normalized);
            } else if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.warn('Unrecognized orchestrator payload', parsed);
            }
        } catch (err) {
            handleError(err as Error);
        }
    };

    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
        void ensureSession();
        const url = withBase(`/api/orchestrator/state/${jobId}`);
        source = new EventSource(url, { withCredentials: true });
        source.onmessage = event => processEventData(event as MessageEvent<string>);
        source.addEventListener('state', event => processEventData(event as MessageEvent<string>));
        source.onerror = event => {
            handleError(event as Event);
            if (source) {
                source.close();
                source = null;
            }
            startPolling();
        };
        source.addEventListener('progress', event => processEventData(event as MessageEvent<string>));
    } else {
        startPolling();
    }

    if (signal) {
        signal.addEventListener('abort', cleanup);
    }

    return cleanup;
}
