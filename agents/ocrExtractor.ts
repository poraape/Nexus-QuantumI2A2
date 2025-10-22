import { logger } from '../services/logger';
import { telemetry } from '../services/telemetry';
import { executeWithResilience } from '../services/resilience';

/**
 * Runs OCR on an image file buffer using Tesseract.js.
 * @param buffer The ArrayBuffer of the image file.
 * @param lang The language for OCR (defaults to 'por' for Portuguese).
 * @returns A promise that resolves to the extracted text.
 */
export async function runOCRFromImage(buffer: ArrayBuffer, lang = "por", correlationId?: string): Promise<string> {
    const correlationId = correlationId || telemetry.createCorrelationId('ocr');
    try {
        const { createWorker } = await executeWithResilience('ocr', 'ocr.loadWorker', async () => import('tesseract.js'), {
            correlationId,
            attributes: { lang },
            maxAttempts: 3,
        });
        const worker = await createWorker(lang);
        const { data } = await executeWithResilience('ocr', 'ocr.recognize', async () => worker.recognize(buffer), {
            correlationId,
            attributes: { lang },
            maxAttempts: 3,
        });
        await worker.terminate();
        logger.log('OCR', 'INFO', 'Processamento OCR concluído.', { lang }, { correlationId, scope: 'ocr' });
        return data.text;
    } catch (error) {
        logger.log('OCR', 'ERROR', 'Tesseract OCR falhou.', { error, lang }, { correlationId, scope: 'ocr' });
        console.error('Tesseract OCR failed:', error);
        throw new Error('Falha ao executar OCR na imagem. A biblioteca Tesseract pode não ter sido carregada.');
    }
}