import React, { useState } from 'react';
import type { DeterministicArtifactDescriptor } from '../types';
import { reportStorage } from '../services/reportStorage';
import { DownloadIcon, FileIcon } from './icons';

interface DeterministicReportDownloadsProps {
    artifacts?: DeterministicArtifactDescriptor[];
}

const formatLabels: Record<DeterministicArtifactDescriptor['format'], string> = {
    json: 'JSON',
    csv: 'CSV',
    md: 'Markdown',
};

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const DeterministicReportDownloads: React.FC<DeterministicReportDownloadsProps> = ({ artifacts }) => {
    const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);

    if (!artifacts || artifacts.length === 0) {
        return null;
    }

    const sortedArtifacts = [...artifacts].sort((a, b) => a.format.localeCompare(b.format));

    const handleDownload = async (artifact: DeterministicArtifactDescriptor) => {
        try {
            setDownloadingFormat(artifact.format);
            const url = await reportStorage.generateDownloadUrl(artifact.executionId, artifact.format);
            if (!url) {
                throw new Error('Artefato não encontrado no repositório determinístico.');
            }
            const link = document.createElement('a');
            link.href = url;
            link.download = artifact.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error('Falha ao iniciar download determinístico:', err);
        } finally {
            setDownloadingFormat(null);
        }
    };

    return (
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/70 space-y-3">
            <div>
                <p className="text-sm font-semibold text-gray-200">Relatórios determinísticos exportados</p>
                <p className="text-xs text-gray-500">Disponibilizados pelo orquestrador para a execução #{artifacts[0].executionId}</p>
            </div>
            <div className="flex flex-col gap-3">
                {sortedArtifacts.map(artifact => (
                    <div key={artifact.format} className="flex items-center justify-between bg-gray-900/40 px-3 py-2 rounded-md border border-gray-700/40">
                        <div className="flex items-center gap-3">
                            <FileIcon className="w-4 h-4 text-gray-500" />
                            <div>
                                <p className="text-sm text-gray-200 font-medium">{artifact.filename}</p>
                                <p className="text-xs text-gray-500">{formatLabels[artifact.format]} • {formatBytes(artifact.size)} • Gerado em {new Date(artifact.createdAt).toLocaleString('pt-BR')}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDownload(artifact)}
                            disabled={downloadingFormat === artifact.format}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                        >
                            <DownloadIcon className="w-4 h-4" />
                            {downloadingFormat === artifact.format ? 'Gerando...' : 'Download'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DeterministicReportDownloads;
