import type {
    AuditReport,
    DeterministicArtifactDescriptor,
    DeterministicContextSnapshot,
    DeterministicCrossValidationResult
} from '../types';
import { parseSafeFloat } from './parsingUtils';
import { logger } from '../services/logger';
import { reportStorage } from '../services/reportStorage';

const ABS_TOLERANCE = 0.001; // Tolerância absoluta máxima (equivale a R$0,001)
const PERCENT_TOLERANCE = 0.001; // 0,1%

interface ItemWithSource extends Record<string, any> {
    docSource: {
        name: string;
        internal_path?: string;
    };
    context: DeterministicContextSnapshot;
}

interface DeterministicRule {
    code: string;
    attributeLabel: string;
    justification: string;
    formatter: (value: number) => string;
}

interface AttributeComparisonConfig {
    field: string;
    rule: DeterministicRule;
}

const currencyFormatter = (value: number): string =>
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const quantityFormatter = (value: number): string =>
    value.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const RULE_DICTIONARY: Record<string, DeterministicRule> = {
    valorTotal: {
        code: 'DET-VAL-001',
        attributeLabel: 'Valor Total do Item',
        justification: 'Diferença superior a 0,1% no valor total para a mesma combinação de NCM, CFOP, CNPJ e data de emissão.',
        formatter: currencyFormatter,
    },
    valorUnitario: {
        code: 'DET-VAL-002',
        attributeLabel: 'Preço Unitário',
        justification: 'Preço unitário divergente além da tolerância de 0,1% para a mesma combinação fiscal.',
        formatter: currencyFormatter,
    },
    quantidade: {
        code: 'DET-QTD-001',
        attributeLabel: 'Quantidade Comercial',
        justification: 'Quantidade informada inconsistente entre documentos correlacionados pelo mesmo contexto fiscal.',
        formatter: quantityFormatter,
    },
    baseICMS: {
        code: 'DET-ICMS-001',
        attributeLabel: 'Base de Cálculo ICMS',
        justification: 'Base de cálculo do ICMS divergente acima da tolerância de 0,1% para itens equivalentes.',
        formatter: currencyFormatter,
    },
    valorICMS: {
        code: 'DET-ICMS-002',
        attributeLabel: 'Valor de ICMS',
        justification: 'Valor de ICMS apurado diferente entre documentos correspondentes além da tolerância estabelecida.',
        formatter: currencyFormatter,
    },
    valorPIS: {
        code: 'DET-PIS-001',
        attributeLabel: 'Valor de PIS',
        justification: 'Crédito/Débito de PIS divergente para a mesma operação correlacionada.',
        formatter: currencyFormatter,
    },
    valorCOFINS: {
        code: 'DET-COFINS-001',
        attributeLabel: 'Valor de COFINS',
        justification: 'Crédito/Débito de COFINS divergente para a mesma operação correlacionada.',
        formatter: currencyFormatter,
    },
};

const ATTRIBUTE_CONFIGS: AttributeComparisonConfig[] = [
    { field: 'produto_valor_total', rule: RULE_DICTIONARY.valorTotal },
    { field: 'produto_valor_unit', rule: RULE_DICTIONARY.valorUnitario },
    { field: 'produto_qtd', rule: RULE_DICTIONARY.quantidade },
    { field: 'produto_base_calculo_icms', rule: RULE_DICTIONARY.baseICMS },
    { field: 'produto_valor_icms', rule: RULE_DICTIONARY.valorICMS },
    { field: 'produto_valor_pis', rule: RULE_DICTIONARY.valorPIS },
    { field: 'produto_valor_cofins', rule: RULE_DICTIONARY.valorCOFINS },
];

const normaliseDate = (value: any): string | undefined => {
    if (!value) return undefined;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        if (trimmed.length >= 10) return trimmed.substring(0, 10);
        return trimmed;
    }
    if (value instanceof Date && !isNaN(value.getTime())) {
        return value.toISOString().substring(0, 10);
    }
    return undefined;
};

const buildContext = (item: Record<string, any>): DeterministicContextSnapshot => {
    const rawDate = item.data_emissao || item.dataEmissao || item.emissao_data || item['ide.dhEmi'];
    return {
        ncm: item.produto_ncm?.toString() || 'N/A',
        cfop: item.produto_cfop?.toString() || 'N/A',
        emitenteCnpj: item.emitente_cnpj?.toString(),
        destinatarioCnpj: item.destinatario_cnpj?.toString(),
        dataEmissao: normaliseDate(rawDate),
        produtoNome: item.produto_nome?.toString(),
    };
};

const buildGroupKey = (context: DeterministicContextSnapshot): string => {
    const parts = [
        context.ncm || 'N/A',
        context.cfop || 'N/A',
        context.emitenteCnpj || 'N/A',
        context.destinatarioCnpj || 'N/A',
        context.dataEmissao || 'N/A',
    ];
    return parts.join('|');
};

const isBeyondTolerance = (reference: number, comparison: number): boolean => {
    const absoluteDiff = Math.abs(reference - comparison);
    if (absoluteDiff <= ABS_TOLERANCE) {
        return false;
    }
    const maxMagnitude = Math.max(Math.abs(reference), Math.abs(comparison));
    if (maxMagnitude === 0) {
        return absoluteDiff > ABS_TOLERANCE;
    }
    const relativeDiff = absoluteDiff / maxMagnitude;
    return relativeDiff > PERCENT_TOLERANCE;
};

const toDeterministicComparisonKey = (context: DeterministicContextSnapshot): string => {
    const datePart = context.dataEmissao ? `Data ${context.dataEmissao}` : 'Data indisponível';
    return `NCM ${context.ncm} • CFOP ${context.cfop} • ${datePart}`;
};

const createDescription = (context: DeterministicContextSnapshot, attributeLabel: string): string => {
    const entities = [context.emitenteCnpj, context.destinatarioCnpj].filter(Boolean).join(' ↔ ');
    const parties = entities ? ` entre ${entities}` : '';
    const product = context.produtoNome ? ` para o item "${context.produtoNome}"` : '';
    const dateInfo = context.dataEmissao ? ` na data ${context.dataEmissao}` : '';
    return `Divergência de ${attributeLabel.toLowerCase()}${product}${parties} correlacionada por NCM ${context.ncm} e CFOP ${context.cfop}${dateInfo}.`;
};

const getNumericValue = (item: Record<string, any>, field: string): number | null => {
    const rawValue = item[field];
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const parsed = parseSafeFloat(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
};

const generateArtifacts = async (
    executionId: string,
    findings: DeterministicCrossValidationResult[],
): Promise<DeterministicArtifactDescriptor[]> => {
    if (findings.length === 0) {
        await reportStorage.saveArtifacts(executionId, []);
        return [];
    }

    const generatedAt = new Date().toISOString();
    const totalDiscrepancies = findings.reduce((sum, finding) => sum + finding.discrepancies.length, 0);

    const jsonContent = JSON.stringify({
        executionId,
        generatedAt,
        totals: {
            regrasAcionadas: findings.length,
            discrepancias: totalDiscrepancies,
        },
        findings: findings.map(finding => ({
            ruleCode: finding.ruleCode,
            attribute: finding.attribute,
            severity: finding.severity,
            justification: finding.justification,
            context: finding.context,
            discrepancies: finding.discrepancies.map(discrepancy => ({
                docA: discrepancy.docA,
                valueA: discrepancy.valueA,
                docB: discrepancy.docB,
                valueB: discrepancy.valueB,
                ruleCode: discrepancy.ruleCode,
                justification: discrepancy.justification,
            })),
        })),
    }, null, 2);

    const csvRows: string[][] = [[
        'execution_id',
        'rule_code',
        'attribute',
        'severity',
        'ncm',
        'cfop',
        'data_emissao',
        'emitente_cnpj',
        'destinatario_cnpj',
        'produto_nome',
        'doc_a',
        'doc_a_path',
        'valor_a',
        'doc_b',
        'doc_b_path',
        'valor_b',
        'justificativa',
    ]];

    findings.forEach(finding => {
        finding.discrepancies.forEach(discrepancy => {
            csvRows.push([
                executionId,
                discrepancy.ruleCode,
                finding.attribute,
                finding.severity,
                finding.context.ncm,
                finding.context.cfop,
                finding.context.dataEmissao || '',
                finding.context.emitenteCnpj || '',
                finding.context.destinatarioCnpj || '',
                finding.context.produtoNome || '',
                discrepancy.docA.name,
                discrepancy.docA.internal_path || '',
                String(discrepancy.valueA),
                discrepancy.docB.name,
                discrepancy.docB.internal_path || '',
                String(discrepancy.valueB),
                discrepancy.justification,
            ]);
        });
    });

    const escapeCsvValue = (value: string): string => {
        const needsQuotes = /[";\n]/.test(value);
        const escaped = value.replace(/"/g, '""');
        return needsQuotes ? `"${escaped}"` : escaped;
    };

    const csvContent = csvRows
        .map(row => row.map(value => escapeCsvValue(value ?? '')).join(';'))
        .join('\n');

    const escapeMarkdown = (value: string): string => value.replace(/\|/g, '\\|');

    const mdHeader = '# Relatório Determinístico de Validação Cruzada';
    const mdIntro = `- Execução: ${executionId}\n- Gerado em: ${generatedAt}\n- Regras acionadas: ${findings.length}\n- Discrepâncias totais: ${totalDiscrepancies}`;
    const mdTableHeader = '| Regra | Atributo | Severidade | NCM | CFOP | Data | Emitente | Destinatário | Documento A | Valor A | Documento B | Valor B | Justificativa |';
    const mdTableSeparator = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

    const mdRows = findings.flatMap(finding => (
        finding.discrepancies.map(discrepancy => (
            `| ${escapeMarkdown(discrepancy.ruleCode)} | ${escapeMarkdown(finding.attribute)} | ${finding.severity} | ${escapeMarkdown(finding.context.ncm)} | ${escapeMarkdown(finding.context.cfop)} | ${escapeMarkdown(finding.context.dataEmissao || '')} | ${escapeMarkdown(finding.context.emitenteCnpj || '')} | ${escapeMarkdown(finding.context.destinatarioCnpj || '')} | ${escapeMarkdown(discrepancy.docA.name)} | ${escapeMarkdown(String(discrepancy.valueA))} | ${escapeMarkdown(discrepancy.docB.name)} | ${escapeMarkdown(String(discrepancy.valueB))} | ${escapeMarkdown(discrepancy.justification)} |`
        ))
    ));

    const mdContent = [mdHeader, '', mdIntro, '', mdTableHeader, mdTableSeparator, ...mdRows].join('\n');

    const artifactsToStore = [
        { format: 'json' as const, filename: `deterministic-cross-validation-${executionId}.json`, content: jsonContent },
        { format: 'csv' as const, filename: `deterministic-cross-validation-${executionId}.csv`, content: csvContent },
        { format: 'md' as const, filename: `deterministic-cross-validation-${executionId}.md`, content: mdContent },
    ];

    return reportStorage.saveArtifacts(executionId, artifactsToStore);
};

export interface DeterministicCrossValidationOutput {
    findings: DeterministicCrossValidationResult[];
    artifacts: DeterministicArtifactDescriptor[];
}

/**
 * Runs deterministic cross-validation checks across all documents in a report.
 * Correlates items using NCM, CNPJ, date and CFOP as deterministic keys.
 * @param report The audit report containing documents to be compared.
 * @param executionId Unique identifier of the orchestration run for traceability.
 * @returns The findings and generated artifact descriptors.
 */
export const runDeterministicCrossValidation = async (
    report: Omit<AuditReport, 'summary'>,
    executionId: string,
): Promise<DeterministicCrossValidationOutput> => {
    const findings: DeterministicCrossValidationResult[] = [];
    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data && d.doc.data.length > 0);

    if (validDocs.length < 1) {
        logger.log('CrossValidator', 'INFO', 'Nenhum documento válido para validação cruzada determinística.');
        await reportStorage.saveArtifacts(executionId, []);
        return { findings: [], artifacts: [] };
    }

    const groups = new Map<string, ItemWithSource[]>();

    for (const doc of validDocs) {
        for (const item of doc.doc.data!) {
            const context = buildContext(item);
            const key = buildGroupKey(context);
            const itemWithSource: ItemWithSource = {
                ...item,
                context,
                docSource: {
                    name: doc.doc.name,
                    internal_path: doc.doc.meta?.internal_path,
                }
            };
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(itemWithSource);
        }
    }

    groups.forEach(items => {
        const uniqueDocs = new Set(items.map(item => item.docSource.name));
        if (uniqueDocs.size < 2) {
            return;
        }

        const sortedItems = [...items].sort((a, b) => a.docSource.name.localeCompare(b.docSource.name));
        const referenceItem = sortedItems[0];

        ATTRIBUTE_CONFIGS.forEach(({ field, rule }) => {
            const referenceValue = getNumericValue(referenceItem, field);
            if (referenceValue === null) {
                return;
            }

            const discrepancies = sortedItems.slice(1).reduce<DeterministicCrossValidationResult['discrepancies']>((acc, candidate) => {
                const comparisonValue = getNumericValue(candidate, field);
                if (comparisonValue === null) {
                    return acc;
                }

                if (isBeyondTolerance(referenceValue, comparisonValue)) {
                    acc.push({
                        valueA: rule.formatter(referenceValue),
                        docA: referenceItem.docSource,
                        valueB: rule.formatter(comparisonValue),
                        docB: candidate.docSource,
                        ruleCode: rule.code,
                        justification: rule.justification,
                    });
                }
                return acc;
            }, []);

            if (discrepancies.length > 0) {
                const context = referenceItem.context;
                const comparisonKey = toDeterministicComparisonKey(context);
                const description = createDescription(context, rule.attributeLabel);

                findings.push({
                    comparisonKey,
                    attribute: rule.attributeLabel,
                    description,
                    discrepancies,
                    severity: 'ALERTA',
                    ruleCode: rule.code,
                    justification: rule.justification,
                    context,
                });

                logger.log('CrossValidator', 'WARN', `Regra ${rule.code} disparada em ${comparisonKey}`, {
                    attribute: rule.attributeLabel,
                    executionId,
                    documentos: Array.from(uniqueDocs),
                });
            }
        });
    });

    const artifacts = await generateArtifacts(executionId, findings);
    return { findings, artifacts };
};
