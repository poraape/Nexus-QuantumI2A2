import type { ImportedDoc } from '../types';
import { runOCRFromImage } from '../agents/ocrExtractor';

// --- Individual File Handlers ---

const handleXML = async (file: File): Promise<ImportedDoc> => {
    const { XMLParser } = await import('fast-xml-parser');
    const text = await file.text();
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        allowBooleanAttributes: true,
        ignoreNameSpace: true, // Handles XML with namespaces
    });
    try {
        const jsonObj = parser.parse(text);
        
        // ROBUSTNESS FIX: Find the <infNFe> block regardless of the root element structure.
        let infNFe;
        if (jsonObj.nfeProc?.NFe?.infNFe) {
            infNFe = jsonObj.nfeProc.NFe.infNFe;
        } else if (jsonObj.NFe?.infNFe) {
            infNFe = jsonObj.NFe.infNFe;
        } else if (jsonObj.infNFe) {
            infNFe = jsonObj.infNFe;
        }

        if (!infNFe) {
            return { kind: "NFE_XML", name: file.name, size: file.size, status: "error", error: "Estrutura NFe inválida: a tag <infNFe> não foi encontrada.", raw: file };
        }

        const details = infNFe.det || [];
        const normalizedDetails = Array.isArray(details) ? details : [details];

        if (normalizedDetails.length === 0 || normalizedDetails[0] === undefined) {
             return { kind: "NFE_XML", name: file.name, size: file.size, status: "error", error: "Não foi possível encontrar itens de nota (<det>) no XML.", raw: file };
        }

        // ENHANCEMENT: Extract common NFe info to enrich the data for each product.
        const ide = infNFe.ide || {};
        const emit = infNFe.emit || {};
        const dest = infNFe.dest || {};
        const total = infNFe.total?.ICMSTot || {};

        const data = normalizedDetails.map((item: any) => {
            const prod = item.prod || {};
            return {
                data_emissao: ide.dhEmi,
                valor_total_nfe: total.vNF,
                emitente_nome: emit.xNome,
                destinatario_nome: dest.xNome,
                produto_codigo: prod.cProd,
                produto_nome: prod.xProd,
                produto_ncm: prod.NCM,
                produto_cfop: prod.CFOP,
                produto_qtd: prod.qCom,
                produto_valor_unit: prod.vUnCom,
                produto_valor_total: prod.vProd,
            };
        });

        return {
            kind: "NFE_XML",
            name: file.name,
            size: file.size,
            status: "parsed",
            data: data,
            raw: file,
        };
    } catch (error) {
        console.error("XML Parsing Error:", error);
        return { kind: "NFE_XML", name: file.name, size: file.size, status: "error", error: "XML inválido ou mal formatado.", raw: file };
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
    // FIX: Import from the correct module path for pdf.js, which is '.mjs'
    const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
    
    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument(buffer);
    try {
        const pdf = await loadingTask.promise;
        let textContent = '';
        let hasTextLayer = false;
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const text = await page.getTextContent();
            if (text.items.length > 0) {
                hasTextLayer = true;
            }
            textContent += text.items.map((s: any) => s.str).join(' ');
        }

        // If there's a significant text layer, consider it a text-based PDF.
        if (hasTextLayer && textContent.trim().length > 50) {
            return {
                kind: "PDF",
                name: file.name,
                size: file.size,
                status: "parsed", // Text is successfully extracted, no OCR needed.
                text: textContent,
                raw: file
            };
        }

        // If no text layer or very little text, it's a scanned PDF. Proceed to OCR.
        const page = await pdf.getPage(1); // Process the first page for OCR.
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (!context) {
            throw new Error("Não foi possível obter o contexto do canvas para renderizar o PDF.");
        }

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // Convert canvas to an image blob, then to an ArrayBuffer for the OCR agent.
        return new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    resolve({ kind: "PDF", name: file.name, size: file.size, status: "error", error: "Falha ao converter PDF para imagem.", raw: file });
                    return;
                }
                const imageBuffer = await blob.arrayBuffer();
                try {
                    const ocrText = await runOCRFromImage(imageBuffer);
                    resolve({
                        kind: "PDF",
                        name: file.name,
                        size: file.size,
                        status: "ocr_needed",
                        text: ocrText,
                        raw: file,
                    });
                } catch (ocrError: any) {
                     resolve({ kind: "PDF", name: file.name, size: file.size, status: "error", error: ocrError.message || "Falha no OCR do PDF.", raw: file });
                }
            }, 'image/png');
        });

    } catch (error) {
        console.error("PDF Processing Error:", error);
        return { kind: "PDF", name: file.name, size: file.size, status: "error", error: "Falha ao processar o arquivo PDF. Pode estar corrompido.", raw: file };
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
    } catch (error: any) {
        return { kind: "IMAGE", name: file.name, size: file.size, status: "error", error: error.message || "Falha no OCR", raw: file };
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