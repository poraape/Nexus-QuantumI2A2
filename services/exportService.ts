export type ExportBundle = Record<string, unknown>;

const JSON_HEADERS = {
    'Content-Type': 'application/json',
};

export const saveAnalysisBundle = async (bundle: ExportBundle): Promise<string | null> => {
    try {
        const response = await fetch('/api/export/bundle', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify(bundle),
        });

        if (!response.ok) {
            throw new Error(`Export bundle failed with status ${response.status}`);
        }

        const data = await response.json();
        return typeof data.bundle_id === 'string' ? data.bundle_id : null;
    } catch (error) {
        console.error('Failed to persist export bundle', error);
        return null;
    }
};

export const downloadFullExport = async (): Promise<void> => {
    const response = await fetch('/api/export/full');
    if (!response.ok) {
        throw new Error(`Export download failed with status ${response.status}`);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'chat_full_export.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
};
