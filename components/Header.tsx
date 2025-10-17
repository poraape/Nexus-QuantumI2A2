import React from 'react';
import { DownloadIcon, LoadingSpinnerIcon, DocumentTextIcon } from './icons';
import type { ExportType } from '../App';
import LogoIcon from './LogoIcon'; // Importa o novo ícone

interface HeaderProps {
    showExports: boolean;
    isExporting: ExportType | null;
    onExport: (type: ExportType) => void;
}

const Header: React.FC<HeaderProps> = ({ showExports, isExporting, onExport }) => {
  const exportOptions: { type: ExportType, label: string, icon: React.ReactNode }[] = [
      { type: 'docx', label: 'DOCX', icon: <DocumentTextIcon className="w-4 h-4" /> },
      { type: 'html', label: 'HTML', icon: <span className="font-bold text-sm">H</span> },
      { type: 'pdf', label: 'PDF', icon: <span className="font-bold text-sm">P</span> },
      { type: 'md', label: 'MD', icon: <span className="font-bold text-sm">M</span> },
  ];

  return (
    <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-700/50 sticky top-0 z-10">
      <div className="container mx-auto px-4 md:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <LogoIcon className="w-9 h-9" />
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300">
                        Nexus QuantumI2A2
                    </h1>
                    <p className="text-xs md:text-sm text-gray-400 -mt-1">
                        Interactive Insight & Intelligence from Fiscal Analysis
                    </p>
                </div>
            </div>
            {showExports && (
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400 hidden sm:block">Exportar Relatório:</span>
                    {exportOptions.map(({ type, label, icon }) => (
                         <button
                            key={type}
                            onClick={() => onExport(type)}
                            disabled={!!isExporting}
                            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait w-9 h-9 flex items-center justify-center"
                            title={`Exportar para ${label}`}
                        >
                            {isExporting === type ? <LoadingSpinnerIcon className="w-4 h-4 animate-spin"/> : icon}
                        </button>
                    ))}
                </div>
            )}
        </div>
      </div>
    </header>
  );
};

export default Header;
