import React, { useRef, useState, useEffect, useCallback } from 'react';
import FileUpload from './components/FileUpload';
import ReportViewer from './components/ReportViewer';
import ChatPanel from './components/ChatPanel';
import Header from './components/Header';
import Toast from './components/Toast';
import ProgressTracker from './components/ProgressTracker';
import PipelineErrorDisplay from './components/PipelineErrorDisplay';
import { useAgentOrchestrator } from './hooks/useAgentOrchestrator';
import { exportToMarkdown, exportToHtml, exportToPdf, exportToDocx, exportToJson, exportToXlsx } from './utils/exportUtils';
import LogsPanel from './components/LogsPanel';
import Dashboard from './components/Dashboard';
import type { AuditReport } from './types';
import IncrementalInsights from './components/IncrementalInsights';
import IntegrationStatusPanel from './components/IntegrationStatusPanel';
import CollapsibleModule from './components/CollapsibleModule';

export type ExportType = 'md' | 'html' | 'pdf' | 'docx' | 'sped' | 'xlsx' | 'json';
type PipelineStep = 'UPLOAD' | 'PROCESSING' | 'COMPLETE' | 'ERROR';

type CollapsibleModuleKey = 'executive' | 'insights' | 'dashboard';

const DEFAULT_MODULE_STATE: Record<CollapsibleModuleKey, boolean> = {
    executive: false,
    insights: false,
    dashboard: false,
};

const App: React.FC = () => {
    const [isExporting, setIsExporting] = useState<ExportType | null>(null);
    const [pipelineStep, setPipelineStep] = useState<PipelineStep>('UPLOAD');
    const [showLogs, setShowLogs] = useState(false);
    const [analysisHistory, setAnalysisHistory] = useState<AuditReport[]>([]);
    const [processedFiles, setProcessedFiles] = useState<File[]>([]);
    const [collapsedModules, setCollapsedModules] = useState(DEFAULT_MODULE_STATE);
    const [autoExportEnabled, setAutoExportEnabled] = useState(false);




    const {
        agentStates,
        auditReport,
        setAuditReport, // from useAgentOrchestrator
        messages,
        isStreaming,
        error,
        isPipelineRunning,
        isPipelineComplete,
        pipelineError,
        runPipeline,
        handleSendMessage,
        handleStopStreaming,
        setError,
        handleClassificationChange,
        reset: resetOrchestrator,
    } = useAgentOrchestrator();

    const collapsedStateRef = useRef(collapsedModules);
    const lastAutoExportExecutionId = useRef<string | null>(null);

    useEffect(() => {
        if (auditReport) {
            setAnalysisHistory(prev => [...prev, auditReport]);
        }
    }, [auditReport]);


    const exportableContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isPipelineRunning) {
            setPipelineStep('PROCESSING');
        }
    }, [isPipelineRunning]);

    useEffect(() => {
        if (isPipelineComplete) {
            setPipelineStep(pipelineError ? 'ERROR' : 'COMPLETE');
        }
    }, [isPipelineComplete, pipelineError]);

    useEffect(() => {
        collapsedStateRef.current = collapsedModules;
    }, [collapsedModules]);

    useEffect(() => {
        if (!autoExportEnabled || pipelineStep !== 'COMPLETE' || !auditReport) {
            return;
        }

        const executionId = auditReport.executionId ?? auditReport.summary.title;
        if (lastAutoExportExecutionId.current === executionId) {
            return;
        }

        lastAutoExportExecutionId.current = executionId;

        const runAutoExport = async () => {
            await handleExport('pdf');
            await handleExport('docx');
        };

        runAutoExport().catch((autoExportError) => {
            console.error('Auto export failed', autoExportError);
        });
    }, [autoExportEnabled, pipelineStep, auditReport]);

    const handleStartAnalysis = (files: File[]) => {
        setCollapsedModules({ ...DEFAULT_MODULE_STATE });
        lastAutoExportExecutionId.current = null;
        setProcessedFiles(files);
        runPipeline(files);
    };

    const handleIncrementalUpload = (newFiles: File[]) => {
        const uniqueNewFiles = newFiles.filter(
            (newFile) => !processedFiles.some((processedFile) => processedFile.name === newFile.name)
        );

        if (uniqueNewFiles.length === 0 && newFiles.length > 0) {
            setError("Todos os arquivos selecionados já foram incluídos na análise atual.");
            return;
        }
        
        if (uniqueNewFiles.length === 0) return;

        const allFiles = [...processedFiles, ...uniqueNewFiles];
        setProcessedFiles(allFiles);
        runPipeline(allFiles);
    };

    const handleReset = () => {
        setCollapsedModules({ ...DEFAULT_MODULE_STATE });
        setPipelineStep('UPLOAD');
        lastAutoExportExecutionId.current = null;
        setError(null);
        setAnalysisHistory([]);
        setAuditReport(null);
        setProcessedFiles([]);
        resetOrchestrator();
    };

    const handleExport = useCallback(async (type: ExportType) => {
        if (!auditReport) return;
        setIsExporting(type);
        const previousCollapsed = { ...collapsedStateRef.current };
        const hadCollapsed = Object.values(previousCollapsed).some(Boolean);
        try {
            if (hadCollapsed) {
                setCollapsedModules({ ...DEFAULT_MODULE_STATE });
                await new Promise(resolve => setTimeout(resolve, 60));
            }
            const filename = auditReport.summary.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

            if (type === 'sped') {
                 if(auditReport.spedFile) {
                    const blob = new Blob([auditReport.spedFile.content], { type: 'text/plain;charset=utf-8' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = auditReport.spedFile.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                 } else {
                    throw new Error("Arquivo SPED não foi gerado.");
                 }
                 return;
            }

            if (type === 'json') {
                await exportToJson(auditReport, filename);
                return;
            }
    
            if (type === 'xlsx') {
                await exportToXlsx(auditReport, filename);
                return;
            }
            
            if (!exportableContentRef.current) return;
            switch (type) {
                case 'md': await exportToMarkdown(exportableContentRef.current, filename); break;
                case 'html': await exportToHtml(exportableContentRef.current, filename, auditReport.summary.title); break;
                case 'pdf': await exportToPdf(exportableContentRef.current, filename, auditReport.summary.title); break;
                case 'docx': await exportToDocx(exportableContentRef.current, filename, auditReport.summary.title); break;
            }
        } catch (exportError) {
            console.error(`Failed to export as ${type}:`, exportError);
            setError(`Falha ao exportar como ${type.toUpperCase()}.`);
        } finally {
            if (hadCollapsed) {
                setCollapsedModules(previousCollapsed);
            }
            setIsExporting(null);
        }
    }, [auditReport, setError]);

    useEffect(() => {
        if (!autoExportEnabled || pipelineStep !== 'COMPLETE' || !auditReport) {
            return;
        }

        const executionId = auditReport.executionId ?? auditReport.summary.title;
        if (lastAutoExportExecutionId.current === executionId) {
            return;
        }

        lastAutoExportExecutionId.current = executionId;

        const runAutoExport = async () => {
            await handleExport('pdf');
            await handleExport('docx');
        };

        runAutoExport().catch((autoExportError) => {
            console.error('Auto export failed', autoExportError);
        });
    }, [autoExportEnabled, pipelineStep, auditReport, handleExport]);

    const toggleModule = (module: CollapsibleModuleKey) => {
        setCollapsedModules(prev => ({
            ...prev,
            [module]: !prev[module],
        }));
    };

    const toggleModule = (module: CollapsibleModuleKey) => {
        setCollapsedModules(prev => ({
            ...prev,
            [module]: !prev[module],
        }));
    };

    const toggleAllModules = () => {
        const allCollapsed = Object.values(collapsedModules).every(Boolean);
        setCollapsedModules(allCollapsed ? { ...DEFAULT_MODULE_STATE } : {
            executive: true,
            insights: true,
            dashboard: true,
        });
    };

    const collapsedCount = Object.values(collapsedModules).filter(Boolean).length;

    const layoutClass = collapsedCount === 3
        ? 'lg:grid-cols-1'
        : collapsedCount === 2
            ? 'lg:[grid-template-columns:minmax(0,0.7fr)_minmax(0,1.3fr)]'
            : collapsedCount === 1
                ? 'lg:[grid-template-columns:minmax(0,0.95fr)_minmax(0,1.05fr)]'
                : 'lg:[grid-template-columns:minmax(0,1.15fr)_minmax(0,0.85fr)]';

    const modulesOrderClass = collapsedCount === 3 ? 'lg:order-2' : 'lg:order-1';
    const chatOrderClass = collapsedCount === 3 ? 'lg:order-1' : 'lg:order-2';

    const renderContent = () => {
        switch (pipelineStep) {
            case 'UPLOAD':
                return (
                    <>
                        <div className="max-w-2xl mx-auto">
                            <FileUpload onStartAnalysis={handleStartAnalysis} disabled={isPipelineRunning} />
                        </div>
                        <IntegrationStatusPanel />
                    </>
                );
            case 'PROCESSING':
                return (
                    <>
                        <div className="max-w-4xl mx-auto">
                            <ProgressTracker agentStates={agentStates} />
                        </div>
                        <IntegrationStatusPanel />
                    </>
                );
            case 'COMPLETE':
                if (!auditReport) return null;
                return (
                    <div ref={exportableContentRef} className="space-y-6">
                        <div className={`grid grid-cols-1 gap-6 lg:gap-8 items-start transition-all duration-300 ${layoutClass}`}>
                            <div className={`space-y-4 ${modulesOrderClass}`}>
                                <CollapsibleModule
                                    title="Análise Executiva"
                                    description="Resumo estratégico completo, métricas-chave e recomendações priorizadas para tomada de decisão imediata."
                                    isCollapsed={collapsedModules.executive}
                                    onToggle={() => toggleModule('executive')}
                                >
                                    <ReportViewer
                                        report={auditReport}
                                        onClassificationChange={handleClassificationChange}
                                    />
                                </CollapsibleModule>

                                <CollapsibleModule
                                    title="Insights & Comparativos"
                                    description="Evolução histórica das análises, inteligência incremental e benchmarks automatizados."
                                    isCollapsed={collapsedModules.insights}
                                    onToggle={() => toggleModule('insights')}
                                >
                                    <IncrementalInsights history={analysisHistory} />
                                </CollapsibleModule>

                                <CollapsibleModule
                                    title="Dashboard Dinâmico"
                                    description="Visualizações interativas, gráficos e indicadores operacionais atualizados em tempo real."
                                    isCollapsed={collapsedModules.dashboard}
                                    onToggle={() => toggleModule('dashboard')}
                                >
                                    <Dashboard report={auditReport} />
                                </CollapsibleModule>
                            </div>
                            <div className={`lg:sticky lg:top-24 transition-all duration-300 ${chatOrderClass}`}>
                                <ChatPanel
                                    messages={messages}
                                    onSendMessage={handleSendMessage}
                                    isStreaming={isStreaming}
                                    onStopStreaming={handleStopStreaming}
                                    reportTitle={auditReport.summary.title}
                                    setError={setError}
                                    onAddFiles={handleIncrementalUpload}
                                />
                            </div>
                        </div>
                        <IntegrationStatusPanel />
                    </div>
                );
            case 'ERROR':
                return (
                    <>
                        <PipelineErrorDisplay onReset={handleReset} errorMessage={error} />
                        <IntegrationStatusPanel />
                    </>
                );
            default:
                return null;
        }
    };
    
    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans">
            <Header
                onReset={handleReset}
                showExports={pipelineStep === 'COMPLETE' && !!auditReport}
                showSpedExport={pipelineStep === 'COMPLETE' && !!auditReport?.spedFile}
                onExport={handleExport}
                isExporting={isExporting}
                onToggleLogs={() => setShowLogs(!showLogs)}
                isPanelCollapsed={Object.values(collapsedModules).every(Boolean)}
                onTogglePanel={pipelineStep === 'COMPLETE' ? toggleAllModules : undefined}
                autoExportEnabled={autoExportEnabled}
                onToggleAutoExport={() => setAutoExportEnabled(prev => {
                    const next = !prev;
                    if (next) {
                        lastAutoExportExecutionId.current = null;
                    }
                    return next;
                })}
            />
            <main className="container mx-auto p-4 md:p-6 lg:p-8">
                <div className="space-y-6">
                    {renderContent()}
                </div>
            </main>
            {error && pipelineStep !== 'ERROR' && <Toast message={error} onClose={() => { setError(null); }} />}
            {showLogs && <LogsPanel onClose={() => setShowLogs(false)} />}
        </div>
    );
};

export default App;