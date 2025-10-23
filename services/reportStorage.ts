import type { DeterministicArtifactDescriptor, DeterministicArtifactFormat } from '../types';

type ArtifactPayload = {
    format: DeterministicArtifactFormat;
    filename: string;
    content: string;
};

type StoredArtifact = DeterministicArtifactDescriptor & {
    content: string;
};

const MIME_TYPES: Record<DeterministicArtifactFormat, string> = {
    json: 'application/json',
    csv: 'text/csv',
    md: 'text/markdown'
};

class ReportStorageService {
    private storage = new Map<string, StoredArtifact[]>();

    private calculateSize(content: string): number {
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(content).length;
        }
        return content.length;
    }

    async saveArtifacts(executionId: string, artifacts: ArtifactPayload[]): Promise<DeterministicArtifactDescriptor[]> {
        const createdAt = new Date().toISOString();
        const storedArtifacts = artifacts.map<StoredArtifact>((artifact) => ({
            executionId,
            format: artifact.format,
            filename: artifact.filename,
            createdAt,
            size: this.calculateSize(artifact.content),
            content: artifact.content
        }));

        const existing = this.storage.get(executionId) || [];
        const merged = storedArtifacts.reduce<StoredArtifact[]>((acc, artifact) => {
            const withoutFormat = acc.filter(a => a.format !== artifact.format);
            return [...withoutFormat, artifact];
        }, existing);

        this.storage.set(executionId, merged);
        return merged.map(({ content: _content, ...descriptor }) => descriptor);
    }

    async listArtifacts(executionId: string): Promise<DeterministicArtifactDescriptor[]> {
        const stored = this.storage.get(executionId) || [];
        return stored.map(({ content: _content, ...descriptor }) => descriptor);
    }

    async getArtifact(executionId: string, format: DeterministicArtifactFormat): Promise<StoredArtifact | undefined> {
        const stored = this.storage.get(executionId) || [];
        return stored.find(artifact => artifact.format === format);
    }

    async generateDownloadUrl(executionId: string, format: DeterministicArtifactFormat): Promise<string | undefined> {
        const artifact = await this.getArtifact(executionId, format);
        if (!artifact) return undefined;

        const blob = new Blob([artifact.content], { type: `${MIME_TYPES[format]};charset=utf-8` });
        const objectUrl = URL.createObjectURL(blob);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        return objectUrl;
    }
}

export const reportStorage = new ReportStorageService();
