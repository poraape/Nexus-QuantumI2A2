import type { IntegrationDashboardData, IntegrationExportJobPayload, IntegrationJobPayload } from '../types';

const API_BASE = import.meta.env?.VITE_INTEGRATION_API ?? '/api/integrations';

export const fetchIntegrationDashboard = async (): Promise<IntegrationDashboardData> => {
    const response = await fetch(`${API_BASE}/status`);
    if (!response.ok) {
        throw new Error('Falha ao consultar status das integrações');
    }
    return response.json();
};

export const triggerImport = async (payload: IntegrationJobPayload) => {
    const response = await fetch(`${API_BASE}/${payload.erp.toLowerCase()}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error('Não foi possível enfileirar importação');
    }
};

export const triggerExport = async (payload: IntegrationExportJobPayload) => {
    const response = await fetch(`${API_BASE}/${payload.erp.toLowerCase()}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error('Não foi possível enfileirar exportação');
    }
};

export const subscribeToQueueEvents = (
    onUpdate: (data: IntegrationDashboardData) => void,
    interval = 10_000,
) => {
    let timer: number | undefined;

    const poll = async () => {
        try {
            const data = await fetchIntegrationDashboard();
            onUpdate(data);
        } catch (error) {
            console.error('[IntegrationApi] Falha ao atualizar dashboard', error);
        } finally {
            timer = window.setTimeout(poll, interval);
        }
    };

    poll();

    return () => {
        if (timer) {
            window.clearTimeout(timer);
        }
    };
};

