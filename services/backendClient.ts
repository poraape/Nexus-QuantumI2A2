import type { AuditReport } from '../types';
import type { AgentStateContract, AnalysisJobContract } from '../src/types/contracts';

export type BackendAgentStatus = AgentStateContract['status'];
export type BackendAgentState = AgentStateContract;

export type AnalysisJobResponse = Omit<AnalysisJobContract, 'result'> & {
    result?: AuditReport | null;
};

export type JobStateUpdateHandler = (update: AnalysisJobResponse) => void;
export type JobStateErrorHandler = (error: Event | Error) => void;

export interface JobStateSubscriptionOptions {
    onUpdate: JobStateUpdateHandler;
    onError?: JobStateErrorHandler;
    signal?: AbortSignal;
}

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

const withBase = (path: string) => `${API_BASE_URL.replace(/\/$/, '')}${path}`;

export async function startAnalysis(files: File[], webhookUrl?: string): Promise<AnalysisJobResponse> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (webhookUrl) {
        formData.append('webhook_url', webhookUrl);
    }

    const response = await fetch(withBase('/api/analysis'), {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao iniciar a análise.');
    }

    return (await response.json()) as AnalysisJobResponse;
}

export async function fetchAnalysis(jobId: string): Promise<AnalysisJobResponse> {
    const response = await fetch(withBase(`/api/analysis/${jobId}`));
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao buscar status da análise.');
    }
    return (await response.json()) as AnalysisJobResponse;
}

export async function fetchProgress(jobId: string): Promise<AnalysisJobResponse> {
    const response = await fetch(withBase(`/api/analysis/${jobId}/progress`));
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Falha ao obter progresso da análise.');
    }
    const payload = await response.json();
    return {
        jobId: payload.jobId,
        status: payload.status,
        agentStates: payload.agentStates,
        error: payload.error,
        result: payload.result ?? null,
    } as AnalysisJobResponse;
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
        const status = update.status?.toLowerCase();
        if (status === 'completed' || status === 'failed') {
            cleanup();
        }
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
            const data = JSON.parse(event.data) as AnalysisJobResponse;
            deliverUpdate(data);
        } catch (err) {
            handleError(err as Error);
        }
    };

    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
        const url = withBase(`/api/orchestrator/state/${jobId}`);
        source = new EventSource(url);
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
    } else {
        startPolling();
    }

    if (signal) {
        signal.addEventListener('abort', cleanup);
    }

    return cleanup;
}
