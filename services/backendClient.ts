import type { AuditReport } from '../types';

export type BackendAgentStatus = 'pending' | 'running' | 'completed' | 'error';
export interface BackendAgentState {
    status: BackendAgentStatus;
    progress?: {
        step?: string;
        current?: number;
        total?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface AnalysisJobResponse {
    jobId: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    agentStates: Record<string, BackendAgentState>;
    error?: string | null;
    result?: AuditReport | null;
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
