import React, { useRef, useState } from 'react';
import FileUpload from './components/FileUpload';
import ReportViewer from './components/ReportViewer';
import ChatPanel from './components/ChatPanel';
import Header from './components/Header';
import Toast from './components/Toast';
import ProgressTracker from './components/ProgressTracker';
import { useAgentOrchestrator } from './hooks/useAgentOrchestrator';
import { exportToMarkdown, exportToHtml, exportToPdf, exportToDocx } from './utils/exportUtils';

export type ExportType = 'md' | 'html' | 'pdf' | 'docx';

const App: React.FC = () => {
    const [isExporting, setIsExporting] = useState<ExportType | null>(null);

    const {
        status,
        progress,
        auditReport,
        messages,
        isStreaming,
        error,
        runPipeline,
        handleSendMessage,
        handleStopStreaming,
        setError,
    } = useAgentOrchestrator();

    const exportableContentRef = useRef<HTMLElement>(null);

    const handleExport = async (type: ExportType) => {
        if (!exportableContentRef.current || !auditReport) return;
        setIsExporting(type);
        try {
            const filename = auditReport.summary.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
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
            setIsExporting(null);
        }
    };
    
    const isLoading = ['ocr', 'auditing', 'classifying', 'accounting'].includes(status);
    
    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans">
            <Header
                showExports={!!auditReport}
                onExport={handleExport}
                isExporting={isExporting}
            />
            <main ref={exportableContentRef} className="container mx-auto p-4 md:p-6 lg:p-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
                    <div className="flex flex-col gap-6 lg:gap-8">
                        <FileUpload onFileUpload={runPipeline} disabled={isLoading} />
                        {isLoading && <ProgressTracker status={status} progress={progress} />}
                        {status === 'ready' && auditReport && <ReportViewer report={auditReport} />}
                    </div>
                    <div className="lg:sticky lg:top-24">
                        {status === 'ready' && (
                            <ChatPanel messages={messages} onSendMessage={handleSendMessage} isStreaming={isStreaming} onStopStreaming={handleStopStreaming} />
                        )}
                    </div>
                </div>
            </main>
            {error && <Toast message={error} onClose={() => { setError(null); }} />}
        </div>
    );
};

export default App;
