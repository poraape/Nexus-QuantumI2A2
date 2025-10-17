import type { ImportedDoc } from '../types';
import { runOCRFromImage } from '../agents/ocrExtractor';

// --- Individual File Handlers ---

const handleXML = async (file: File): Promise<ImportedDoc> => {
    const { XMLParser } = await import('fast-xml-parser');
    const text = await file.text();
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        allowBooleanAttributes: true
    });
    try {
        const jsonObj = parser.parse(text);
        // Basic normalization for NFe XML structure
        const nfeProc = jsonObj.nfeProc || jsonObj.NFe;
        const data = nfeProc?.NFe?.infNFe?.det || [];
        const normalizedData = Array.isArray(data) ? data : [data];

        return {
            kind: "NFE_XML", name: file.name, size: file.size, status: "parsed",
            data: normalizedData.map((item: any) => item.prod),
            raw: file,
        };
    } catch (error) {
        return { kind: "NFE_XML", name: file.name, size: file.size, status: "error", error: "XML inválido", raw: file };
    }
};

const handleCSV = async (file: File): Promise<ImportedDoc> => {
    const Papa = (await import('papaparse')).default;
    const text = await file.text();
    return new Promise((resolve) => {
        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                resolve({
                    kind: "CSV", name: file.name, size: file.size, status: "parsed",
                    data: results.data as Record<string, any>[],
                    raw: file,
                });
            },
            error: (err) => {
                resolve({ kind: "CSV", name: file.name, size: file.size, status: "error", error: err.message, raw: file });
            }
        });
    });
};

const handleXLSX = async (file: File): Promise<ImportedDoc> => {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    try {
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        return {
            kind: "XLSX", name: file.name, size: file.size, status: "parsed",
            data: data as Record<string, any>[],
            raw: file
        };
    } catch (error) {
        return { kind: "XLSX", name: file.name, size: file.size, status: "error", error: "Arquivo XLSX inválido", raw: file };
    }
};

const handlePDF = async (file: File): Promise<ImportedDoc> => {
    const pdfjsLib = await import('pdfjs-dist/build/pdf');
    // In AI Studio, worker is loaded via importmap. For local dev, you'd set workerSrc.
    // pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    
    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument(buffer);
    try {
        const pdf = await loadingTask.promise;
        let textContent = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const text = await page.getTextContent();
            textContent += text.items.map((s: any) => s.str).join(' ');
        }
        
        // If text is very short, it's likely a scanned PDF needing OCR
        if (textContent.trim().length < 100) {
             return handleImage(file); // Re-route to OCR
        }

        return {
            kind: "PDF", name: file.name, size: file.size, status: "ocr_needed",
            text: textContent,
            raw: file
        };
    } catch (error) {
        return { kind: "PDF", name: file.name, size: file.size, status: "error", error: "Falha ao processar PDF", raw: file };
    }
};

const handleImage = async (file: File): Promise<ImportedDoc> => {
    const buffer = await file.arrayBuffer();
    try {
        const text = await runOCRFromImage(buffer);
        return {
            kind: "IMAGE", name: file.name, size: file.size, status: "ocr_needed",
            text: text,
            raw: file
        };
    } catch (error) {
        return { kind: "IMAGE", name: file.name, size: file.size, status: "error", error: "Falha no OCR", raw: file };
    }
};

const INTERNAL_FILE_SIZE_LIMIT_MB = 10;
const INTERNAL_FILE_SIZE_LIMIT_BYTES = INTERNAL_FILE_SIZE_LIMIT_MB * 1024 * 1024;

const handleZIP = async (file: File): Promise<ImportedDoc[]> => {
    const JSZip = (await import('jszip')).default;
    const results: ImportedDoc[] = [];

    try {
        const buffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);
        const filesToProcess: { name: string, entry: any }[] = [];
        
        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir) {
                filesToProcess.push({ name: relativePath, entry: zipEntry });
            }
        });

        for (const { name: internalName, entry } of filesToProcess) {
            const internalFileBuffer = await entry.async('arraybuffer');

            if (internalFileBuffer.byteLength > INTERNAL_FILE_SIZE_LIMIT_BYTES) {
                 results.push({
                    kind: "UNSUPPORTED",
                    name: internalName,
                    size: internalFileBuffer.byteLength,
                    status: "error",
                    error: `Arquivo interno excede o limite de ${INTERNAL_FILE_SIZE_LIMIT_MB} MB.`,
                    raw: new File([internalFileBuffer], internalName),
                    meta: { source_zip: file.name, internal_path: internalName },
                 });
                 continue;
            }

            const internalFile = new File([internalFileBuffer], internalName);
            // Recursively call importFiles, but without the progress handler.
            const parsedDocs = await importFiles([internalFile]);

            parsedDocs.forEach(doc => {
                doc.meta = { source_zip: file.name, internal_path: internalName };
                results.push(doc);
            });
        }
    } catch (e) {
        console.error(`Error processing ZIP file ${file.name}:`, e);
        results.push({
            kind: "UNSUPPORTED",
            name: file.name,
            size: file.size,
            status: 'error',
            error: 'Falha ao ler o arquivo ZIP. Pode estar corrompido.',
            raw: file
        });
    }

    return results;
}


// --- Main Pipeline Orchestrator ---

export async function importFiles(
    files: File[],
    onProgress?: (current: number, total: number) => void
): Promise<ImportedDoc[]> {
    const results: ImportedDoc[] = [];
    if (onProgress) onProgress(0, files.length);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const mime = file.type || "";
        const name = file.name.toLowerCase();
        let result: ImportedDoc | ImportedDoc[];

        if (mime.includes("zip") || name.endsWith(".zip") || mime.includes("x-zip-compressed")) {
            result = await handleZIP(file);
        } else if (mime.includes("xml") || name.endsWith(".xml")) {
            result = await handleXML(file);
        } else if (mime.includes("csv") || name.endsWith(".csv")) {
            result = await handleCSV(file);
        } else if (name.endsWith(".xlsx")) {
            result = await handleXLSX(file);
        } else if (mime === "application/pdf" || name.endsWith(".pdf")) {
            result = await handlePDF(file);
        } else if (mime.startsWith("image/")) {
            result = await handleImage(file);
        } else {
            result = { kind: "UNSUPPORTED", name: file.name, size: file.size, status: "unsupported", raw: file };
        }
        
        if (Array.isArray(result)) {
            results.push(...result);
        } else {
            results.push(result);
        }
        
        if (onProgress) onProgress(i + 1, files.length);
    }
    return results;
}