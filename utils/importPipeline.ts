import type { ImportedDoc } from '../types';
import { runOCRFromImage } from '../agents/ocrExtractor';
// FIX: Import `JSZipObject` type to correctly type items from the zip archive.
import JSZip, { type JSZipObject } from 'jszip';
import Papa from 'papaparse';

// Set up PDF.js worker
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@^4.8.69/build/pdf.worker.mjs`;


// --- Helper Functions ---

const getFileExtension = (filename: string): string => {
    return filename.slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
};

const getInfNFe = (nfeData: any): any => {
    if (!nfeData) return null;
    return nfeData?.nfeProc?.NFe?.infNFe 
        || nfeData?.NFe?.infNFe 
        || nfeData?.infNFe;
}

const normalizeNFeData = (nfeData: any): Record<string, any>[] => {
    const infNFe = getInfNFe(nfeData);
    if (!infNFe) return [];

    const det = infNFe.det;
    if (!det) return [];

    const items = Array.isArray(det) ? det : [det];
    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const total = infNFe.total?.ICMSTot || {};

    // Helper to find CST inside the ICMS block, which can have various structures like ICMS00, ICMS10 etc.
    const findIcmsCst = (imposto: any): string | undefined => {
        const icms = imposto?.ICMS;
        if (!icms) return undefined;
        // The ICMS object contains a key like ICMS00, ICMS10, etc. We get the first key.
        const icmsTypeKey = Object.keys(icms)[0];
        if (icmsTypeKey && icms[icmsTypeKey] && icms[icmsTypeKey].CST) {
            return icms[icmsTypeKey].CST.toString();
        }
        return undefined;
    };

    return items.map((item: any) => ({
        data_emissao: ide.dhEmi,
        valor_total_nfe: total.vNF,
        emitente_nome: emit.xNome,
        emitente_uf: emit.enderEmit?.UF,
        destinatario_nome: dest.xNome,
        destinatario_uf: dest.enderDest?.UF,
        produto_nome: item.prod?.xProd,
        produto_ncm: item.prod?.NCM,
        produto_cfop: item.prod?.CFOP,
        produto_cst_icms: findIcmsCst(item.imposto),
        produto_qtd: item.prod?.qCom,
        produto_valor_unit: item.prod?.vUnCom,
        produto_valor_total: item.prod?.vProd,
    }));
};


// --- Individual File Handlers ---

const handleXML = async (file: File): Promise<ImportedDoc> => {
    try {
        const { XMLParser } = await import('fast-xml-parser');
        const text = await file.text();
        const parser = new XMLParser();
        const jsonObj = parser.parse(text);
        const data = normalizeNFeData(jsonObj);

        if (data.length === 0) {
            return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'error', error: 'Nenhum item de produto encontrado no XML.', raw: file };
        }
        return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'parsed', data, raw: file };
    } catch (error: any) {
        return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'error', error: `Erro ao processar XML: ${error.message}`, raw: file };
    }
};

const handleCSV = (file: File): Promise<ImportedDoc> => {
    return new Promise((resolve) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                resolve({ kind: 'CSV', name: file.name, size: file.size, status: 'parsed', data: results.data as Record<string, any>[], raw: file });
            },
            error: (error: any) => {
                resolve({ kind: 'CSV', name: file.name, size: file.size, status: 'error', error: `Erro ao processar CSV: ${error.message}`, raw: file });
            },
        });
    });
};

const handleXLSX = async (file: File): Promise<ImportedDoc> => {
    try {
        const { read, utils } = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = utils.sheet_to_json(worksheet) as Record<string, any>[];
        return { kind: 'XLSX', name: file.name, size: file.size, status: 'parsed', data, raw: file };
    } catch (error: any) {
        return { kind: 'XLSX', name: file.name, size: file.size, status: 'error', error: `Erro ao processar XLSX: ${error.message}`, raw: file };
    }
};

const handleImage = async (file: File): Promise<ImportedDoc> => {
    try {
        const buffer = await file.arrayBuffer();
        const text = await runOCRFromImage(buffer);
        if (!text.trim()) {
            return { kind: 'IMAGE', name: file.name, size: file.size, status: 'error', error: 'Nenhum texto detectado na imagem.', raw: file };
        }
        return { kind: 'IMAGE', name: file.name, size: file.size, status: 'parsed', text, raw: file };
    } catch (error: any) {
        return { kind: 'IMAGE', name: file.name, size: file.size, status: 'error', error: error.message, raw: file };
    }
};

const handlePDF = async (file: File): Promise<ImportedDoc> => {
    try {
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(buffer).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map((item: any) => item.str).join(' ');
        }
        if (fullText.trim()) {
            return { kind: 'PDF', name: file.name, size: file.size, status: 'parsed', text: fullText, raw: file };
        } else {
            const ocrText = await runOCRFromImage(buffer);
            if (!ocrText.trim()) {
                throw new Error("Documento PDF parece estar vazio ou não contém texto legível.");
            }
            return { kind: 'PDF', name: file.name, size: file.size, status: 'parsed', text: ocrText, raw: file };
        }
    } catch (error: any) {
        return { kind: 'PDF', name: file.name, size: file.size, status: 'error', error: `Falha no processamento do PDF: ${error.message}`, raw: file };
    }
};

const handleUnsupported = (file: File): ImportedDoc => ({
    kind: 'UNSUPPORTED', name: file.name, size: file.size, status: 'unsupported', raw: file
});

// --- Main Pipeline ---

const isSupported = (name: string): boolean => {
    const supportedExtensions = ['.xml', '.csv', '.xlsx', '.xls', '.pdf', '.jpg', '.jpeg', '.png', '.zip'];
    return supportedExtensions.some(ext => name.toLowerCase().endsWith(ext));
};

const processSingleFile = (file: File): Promise<ImportedDoc> => {
    const extension = getFileExtension(file.name);
    switch (extension) {
        case 'xml': return handleXML(file);
        case 'csv': return handleCSV(file);
        case 'xlsx': case 'xls': return handleXLSX(file);
        case 'pdf': return handlePDF(file);
        case 'png': case 'jpg': case 'jpeg': return handleImage(file);
        default: return Promise.resolve(handleUnsupported(file));
    }
};

export const importFiles = async (
    files: File[],
    onProgress: (current: number, total: number) => void
): Promise<ImportedDoc[]> => {
    const allDocsPromises: Promise<ImportedDoc | ImportedDoc[]>[] = [];
    let progressCounter = 0;

    onProgress(0, files.length);

    for (const file of files) {
        const promise = (async () => {
            let result;
            const extension = getFileExtension(file.name);
            if (extension === 'zip') {
                try {
                    const jszip = new JSZip();
                    const zip = await jszip.loadAsync(file);
                    // FIX: Explicitly type `zipFile` to ensure properties are accessible.
                    const filesInZip = Object.values(zip.files).filter(
                        (zipFile: JSZipObject) => !zipFile.dir && isSupported(zipFile.name) && !zipFile.name.startsWith('__MACOSX/') && !zipFile.name.endsWith('.DS_Store')
                    );
                    
                    // FIX: Explicitly type `zipEntry` to ensure properties are accessible.
                    const innerDocs = await Promise.all(filesInZip.map(async (zipEntry: JSZipObject) => {
                        const blob = await zipEntry.async('blob');
                        const innerFile = new File([blob], zipEntry.name, { type: blob.type });
                        const doc = await processSingleFile(innerFile);
                        doc.meta = { source_zip: file.name, internal_path: zipEntry.name };
                        return doc;
                    }));
                    result = innerDocs;

                } catch (e: any) {
                    result = { kind: 'UNSUPPORTED', name: file.name, size: file.size, status: 'error', error: `Falha ao descompactar o arquivo: ${e.message}` };
                }
            } else {
                result = await processSingleFile(file);
            }
            progressCounter++;
            onProgress(progressCounter, files.length);
            return result;
        })();
        allDocsPromises.push(promise);
    }

    const results = await Promise.all(allDocsPromises);
    return results.flat();
};