import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntegrationDashboardData, IntegrationStatus } from '../types';
import { fetchIntegrationDashboard, subscribeToQueueEvents, triggerExport, triggerImport } from '../services/integrationApi';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/pt-br';

dayjs.extend(relativeTime);
dayjs.locale('pt-br');

const statusBadgeClasses: Record<IntegrationStatus['state'], string> = {
    idle: 'bg-gray-600 text-gray-100',
    running: 'bg-blue-600 text-white animate-pulse',
    error: 'bg-red-600 text-white',
};

const erpLabels: Record<IntegrationStatus['erp'], string> = {
    TINY: 'Tiny',
    BLING: 'Bling',
    CONTA_AZUL: 'Conta Azul',
};

const IntegrationStatusPanel: React.FC = () => {
    const [dashboard, setDashboard] = useState<IntegrationDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);

    const loadDashboard = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchIntegrationDashboard();
            setDashboard(data);
            setError(null);
            if (!unsubscribeRef.current) {
                unsubscribeRef.current = subscribeToQueueEvents((nextData) => setDashboard(nextData));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Falha ao carregar integrações');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadDashboard();

        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, [loadDashboard]);

    const history = useMemo(() => dashboard?.history ?? [], [dashboard]);

    const handleImport = async (status: IntegrationStatus) => {
        try {
            await triggerImport({ erp: status.erp, companyId: 'default', requestedBy: 'frontend' });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Falha ao acionar importação');
        }
    };

    const handleExport = async (status: IntegrationStatus) => {
        try {
            await triggerExport({ erp: status.erp, companyId: 'default', requestedBy: 'frontend', documents: [] });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Falha ao acionar exportação');
        }
    };

    if (loading) {
        return <div className="bg-gray-800 p-4 rounded-lg text-gray-300">Carregando integrações...</div>;
    }

    if (error) {
        return (
            <div className="bg-red-900/60 border border-red-700 text-red-200 p-4 rounded-lg">
                <p className="font-semibold">Erro ao carregar integrações</p>
                <p className="text-sm">{error}</p>
                <button
                    className="mt-3 px-3 py-2 bg-red-700 hover:bg-red-600 rounded-md text-sm font-medium"
                    onClick={() => void loadDashboard()}
                >
                    Tentar novamente
                </button>
            </div>
        );
    }

    if (!dashboard) return null;

    return (
        <div className="bg-gray-800/70 rounded-lg p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-100">Integrações ERP</h2>
                    <p className="text-sm text-gray-400">Sincronização automática com Tiny, Bling e Conta Azul</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {dashboard.statuses.map((status) => (
                    <div key={status.erp} className="bg-gray-900/70 p-4 rounded-lg border border-gray-700 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-lg font-semibold text-gray-100">{erpLabels[status.erp]}</span>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusBadgeClasses[status.state]}`}>
                                {status.state === 'idle' ? 'Pronto' : status.state === 'running' ? 'Processando' : 'Erro'}
                            </span>
                        </div>
                        <div className="text-sm text-gray-400 space-y-1">
                            <p>Última execução: {status.lastRunAt ? dayjs(status.lastRunAt).fromNow() : 'Nunca'}</p>
                            <p>Último sucesso: {status.lastSuccessAt ? dayjs(status.lastSuccessAt).fromNow() : 'Nunca'}</p>
                            {status.lastError && <p className="text-red-400">Erro: {status.lastError}</p>}
                            <p>Jobs pendentes: <span className="text-teal-300 font-semibold">{status.pendingJobs}</span></p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 rounded-md transition"
                                onClick={() => handleImport(status)}
                            >
                                Importar agora
                            </button>
                            <button
                                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2 rounded-md transition"
                                onClick={() => handleExport(status)}
                            >
                                Exportar SPED
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div>
                <h3 className="text-lg font-semibold text-gray-200">Histórico de integrações</h3>
                <div className="max-h-64 overflow-y-auto mt-3 border border-gray-700 rounded-lg">
                    <table className="w-full text-sm text-left text-gray-300">
                        <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-2">Horário</th>
                                <th className="px-4 py-2">ERP</th>
                                <th className="px-4 py-2">Ação</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2">Mensagem</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.length === 0 && (
                                <tr>
                                    <td className="px-4 py-3 text-center text-gray-500" colSpan={5}>
                                        Nenhuma execução registrada.
                                    </td>
                                </tr>
                            )}
                            {history.map((entry) => (
                                <tr key={entry.id} className="border-t border-gray-800 hover:bg-gray-900/60">
                                    <td className="px-4 py-2">{dayjs(entry.timestamp).format('DD/MM HH:mm')}</td>
                                    <td className="px-4 py-2">{erpLabels[entry.erp]}</td>
                                    <td className="px-4 py-2">{entry.action === 'import' ? 'Importação' : 'Exportação'}</td>
                                    <td className="px-4 py-2">
                                        <span className={`px-2 py-1 rounded-md text-xs ${entry.status === 'success' ? 'bg-emerald-700 text-emerald-100' : entry.status === 'error' ? 'bg-red-700 text-red-100' : 'bg-gray-700 text-gray-100'}`}>
                                            {entry.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-gray-400">
                                        {entry.message ?? '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default IntegrationStatusPanel;

