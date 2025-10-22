import React, { useState } from 'react';
import { downloadFullExport } from '../services/exportService';

const ExportButton: React.FC = () => {
    const [loading, setLoading] = useState(false);

    const handleExport = async () => {
        setLoading(true);
        try {
            await downloadFullExport();
        } catch (error) {
            console.error('Export download failed', error);
            alert('Erro ao exportar conteúdo completo. Verifique sua conexão e tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleExport}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl transition-colors"
        >
            {loading ? 'Gerando Exportação...' : 'Exportar Tudo (Análises, Insights, Dashboard, Chat)'}
        </button>
    );
};

export default ExportButton;
