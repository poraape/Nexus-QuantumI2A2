import React, { useEffect, useMemo, useState } from 'react';
import type { AuditReport } from '../../types';
import { parseSafeFloat } from '../../utils/parsingUtils';

type RatesMap = Record<string, number>;

const DEFAULT_RATES: RatesMap = {
    SP: 0.18,
    RJ: 0.12,
    MG: 0.18,
    ES: 0.12,
    BA: 0.12,
    PR: 0.12,
    RS: 0.12,
    SC: 0.12,
    DF: 0.18,
    AM: 0.18,
};

const STORAGE_KEY = 'nexus-icms-overrides';

const formatCurrency = (value: number) =>
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const loadStoredRates = (): RatesMap => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return {};
        const parsed = JSON.parse(stored);
        if (typeof parsed !== 'object' || parsed === null) return {};
        return Object.entries(parsed).reduce<RatesMap>((acc, [uf, rate]) => {
            const numeric = Number(rate);
            if (!Number.isNaN(numeric)) {
                acc[uf] = numeric;
            }
            return acc;
        }, {});
    } catch {
        return {};
    }
};

const persistRates = (rates: RatesMap) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
    } catch {
        /* ignore storage failures */
    }
};

const normalizeRate = (value: number) => (value > 1 ? value / 100 : value);

interface WhatIfICMSProps {
    report: AuditReport;
}

const WhatIfICMS: React.FC<WhatIfICMSProps> = ({ report }) => {
    const [overrides, setOverrides] = useState<RatesMap>(() => loadStoredRates());

    const { baseValue, originState, destinationStates } = useMemo(() => {
        const validDocs = report.documents.filter(
            (doc) => doc.status !== 'ERRO' && Array.isArray(doc.doc.data) && doc.doc.data.length > 0,
        );

        if (validDocs.length === 0) {
            return { baseValue: 0, originState: 'SP', destinationStates: new Set<string>() };
        }

        const firstItem = validDocs[0].doc.data![0];
        const origin =
            (firstItem.emitente_uf as string | undefined) ??
            (firstItem.origem_uf as string | undefined) ??
            'SP';

        const destinations = new Set<string>();

        let total = 0;
        for (const doc of validDocs) {
            doc.doc.data!.forEach((item) => {
                const dest =
                    (item.destinatario_uf as string | undefined) ??
                    (item.uf as string | undefined) ??
                    (item.uf_destino as string | undefined);
                if (dest) destinations.add(dest.toUpperCase());
                total += parseSafeFloat(item.produto_valor_total);
            });
        }

        if (destinations.size === 0 && firstItem.destinatario_uf) {
            destinations.add(String(firstItem.destinatario_uf).toUpperCase());
        }

        return {
            baseValue: total,
            originState: origin.toUpperCase(),
            destinationStates: destinations,
        };
    }, [report]);

    useEffect(() => {
        const allStates = new Set<string>([
            ...Object.keys(DEFAULT_RATES),
            ...Object.keys(overrides),
            originState,
            ...destinationStates,
        ]);

        let changed = false;
        const updatedOverrides: RatesMap = { ...overrides };

        allStates.forEach((uf) => {
            if (!(uf in updatedOverrides)) {
                const baseRate = DEFAULT_RATES[uf] ?? DEFAULT_RATES.SP;
                updatedOverrides[uf] = baseRate;
                changed = true;
            }
        });

        if (changed) {
            setOverrides(updatedOverrides);
        }
    }, [destinationStates, originState, overrides]);

    useEffect(() => {
        persistRates(overrides);
    }, [overrides]);

    if (baseValue <= 0) {
        return (
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <h2 className="text-lg font-semibold text-gray-200 mb-2">
                    Simulação Tributária (What-If ICMS)
                </h2>
                <p className="text-sm text-gray-400">
                    Nenhum valor de produto foi identificado nos documentos válidos para realizar a simulação.
                </p>
            </div>
        );
    }

    const states = Array.from(
        new Set<string>([
            originState,
            ...destinationStates,
            ...Object.keys(DEFAULT_RATES),
            ...Object.keys(overrides),
        ]),
    ).sort();

    const rows = states.map((uf) => {
        const currentRate = normalizeRate(overrides[uf] ?? DEFAULT_RATES[uf] ?? DEFAULT_RATES.SP);
        const icms = baseValue * currentRate;
        return {
            uf,
            rate: currentRate,
            icms,
        };
    });

    const handleRateChange = (uf: string, value: string) => {
        const numeric = Number(value.replace(',', '.'));
        if (Number.isNaN(numeric)) {
            return;
        }
        setOverrides((prev) => ({
            ...prev,
            [uf]: numeric / 100,
        }));
    };

    return (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 mt-8">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 className="text-lg font-semibold text-gray-200">
                        Simulação Tributária (What-If ICMS por UF)
                    </h2>
                    <p className="text-xs text-gray-400">
                        Origem atual: <span className="font-semibold text-blue-300">{originState}</span> — Base de
                        cálculo: <span className="font-semibold text-blue-300">{formatCurrency(baseValue)}</span>
                    </p>
                </div>
                <p className="text-xs text-gray-500 max-w-md">
                    Ajuste as alíquotas (%) conforme legislação atualizada. Os valores são persistidos localmente no
                    navegador.
                </p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs uppercase bg-gray-700/60 text-gray-300">
                        <tr>
                            <th className="px-3 py-2">UF</th>
                            <th className="px-3 py-2">Alíquota (%)</th>
                            <th className="px-3 py-2">ICMS Estimado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ uf, rate, icms }) => (
                            <tr key={uf} className="border-t border-gray-700/60">
                                <td className="px-3 py-2 text-gray-200 font-semibold">{uf}</td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            className="w-20 rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            value={(rate * 100).toFixed(2)}
                                            onChange={(event) => handleRateChange(uf, event.target.value)}
                                            aria-label={`Alíquota ICMS ${uf}`}
                                        />
                                        <span className="text-xs text-gray-500">% </span>
                                    </div>
                                </td>
                                <td className="px-3 py-2 text-gray-200 font-mono">
                                    {formatCurrency(icms)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default WhatIfICMS;
