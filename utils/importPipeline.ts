import type { ImportedDoc } from '../types';
import { runOCRFromImage } from '../agents/ocrExtractor';
import { extractDataFromText } from '../agents/nlpAgent';
import { logger } from '../services/logger';
import { parseSafeFloat } from './parsingUtils';

import JSZip, { type JSZipObject } from 'jszip';
import Papa from 'papaparse';

// Set up PDF.js worker
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@^4.8.69/build/pdf.worker.mjs`;


// --- Helper Functions ---

const getFileExtension = (filename: string): string => {
    return filename.slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
};

const sanitizeFilename = (filename: string): string => {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const FILE_SIGNATURES: Record<string, string[]> = {
    'pdf': ['25504446'], // %PDF
    'png': ['89504e47'], // .PNG
    'jpg': ['ffd8ff'],   // Various JPEG signatures
    'zip': ['504b0304', '504b0506', '504b0708'], // PK..
    'xml': ['3c3f786d6c'], // <?xml
    'xlsx': ['504b0304'], // Also a zip file
};

const checkMagicNumbers = async (file: File): Promise<boolean> => {
    const extension = getFileExtension(file.name);
    const signatures = FILE_SIGNATURES[extension];
    if (!signatures) return true; // No signature to check

    try {
        const slice = file.slice(0, 8); // Increased slice size to handle longer signatures
        const buffer = await slice.arrayBuffer();
        const view = new DataView(buffer);
        const fileHeader = Array.from({ length: view.byteLength }, (_, i) => view.getUint8(i).toString(16).padStart(2, '0')).join('');
        
        return signatures.some(sig => fileHeader.startsWith(sig));
    } catch (e) {
        logger.log('ImportPipeline', 'ERROR', `Falha ao ler o cabeçalho do arquivo ${file.name}`, { error: e });
        return false;
    }
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

    const items = infNFe.det; // Guaranteed to be an array by the parser config if the tag exists
    if (!items || items.length === 0) {
        return [];
    }
    
    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const total = infNFe.total?.ICMSTot || {};
    const nfeId = infNFe.Id;

    const findTaxInfo = (imposto: any, tributo: 'ICMS' | 'PIS' | 'COFINS'): { cst?: string; value?: number; baseCalculo?: number; aliquota?: number } => {
        const impostoBlock = imposto?.[tributo];
        if (!impostoBlock) return {};
        
        const typeKey = Object.keys(impostoBlock)[0];
        if (typeKey && impostoBlock[typeKey]) {
            const taxDetails = impostoBlock[typeKey];
            const valueKey = `v${tributo}`;
            const baseCalculoKey = 'vBC';
            const aliquotaKey = `p${tributo}`;
            return {
                cst: taxDetails.CST?.toString(),
                value: taxDetails[valueKey],
                baseCalculo: taxDetails[baseCalculoKey],
                aliquota: taxDetails[aliquotaKey]
            };
        }
        return {};
    };


    return items.map((item: any) => {
        const icmsInfo = findTaxInfo(item.imposto, 'ICMS');
        const pisInfo = findTaxInfo(item.imposto, 'PIS');
        const cofinsInfo = findTaxInfo(item.imposto, 'COFINS');
        
        if (!item.prod?.vProd) {
            logger.log('ImportPipeline', 'WARN', `Item ${item.prod?.cProd || 'sem código'} no documento ${nfeId} não possui valor (vProd).`);
        }
        if (!item.prod?.CFOP) {
            logger.log('ImportPipeline', 'WARN', `Item ${item.prod?.cProd || 'sem código'} no documento ${nfeId} не possui CFOP.`);
        }

        return {
            nfe_id: nfeId,
            data_emissao: ide.dhEmi,
            valor_total_nfe: parseSafeFloat(total.vNF),
            emitente_nome: emit.xNome,
            emitente_uf: emit.enderEmit?.UF,
            destinatario_nome: dest.xNome,
            destinatario_uf: dest.enderDest?.UF,
            produto_nome: item.prod?.xProd,
            produto_ncm: item.prod?.NCM,
            produto_cfop: item.prod?.CFOP,
            produto_cst_icms: icmsInfo.cst,
            produto_base_calculo_icms: parseSafeFloat(icmsInfo.baseCalculo),
            produto_aliquota_icms: parseSafeFloat(icmsInfo.aliquota),
            produto_valor_icms: parseSafeFloat(icmsInfo.value),
            produto_cst_pis: pisInfo.cst,
            produto_valor_pis: parseSafeFloat(pisInfo.value),
            produto_cst_cofins: cofinsInfo.cst,
            produto_valor_cofins: parseSafeFloat(cofinsInfo.value),
            produto_qtd: parseSafeFloat(item.prod?.qCom),
            produto_valor_unit: parseSafeFloat(item.prod?.vUnCom),
            produto_valor_total: parseSafeFloat(item.prod?.vProd),
        }
    });
};


// --- Individual File Handlers ---

const handleXML = async (file: File): Promise<ImportedDoc> => {
    try {
        const { XMLParser } = await import('fast-xml-parser');
        const text = await file.text();
        const parser = new XMLParser({
            // Performance and Consistency options
            ignoreAttributes: false, // Keep attributes like 'Id' and 'nItem'
            ignoreNameSpace: true,  // Simplifies path by removing namespace prefixes
            parseNodeValue: false,  // Delegate parsing to our specific functions for performance
            parseAttributeValue: false, // Delegate parsing to our specific functions for performance
            trimValues: true,       // Sanitize data by removing whitespace
            attributeNamePrefix: "",// Clean attribute names
            // Ensure <det> is always an array for consistent data structure
            isArray: (name) => name === 'det',
        });
        const jsonObj = parser.parse(text);
        const data = normalizeNFeData(jsonObj);

        if (data.length === 0) {
            return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'error', error: 'Nenhum item de produto encontrado no XML ou XML malformado.', raw: file };
        }
        return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'parsed', data, raw: file };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'error', error: `Erro ao processar XML: ${message}`, raw: file };
    }
};

const handleCSV = (file: File): Promise<ImportedDoc> => {
    return new Promise((resolve) => {
        Papa.parse(file, {
            header: true, // Automatically detect and use the first row as headers.
            skipEmptyLines: true, // Ignore empty lines to avoid processing invalid data.
            dynamicTyping: true, // Automatically convert numeric and boolean strings to their types.
            // Normalize headers to snake_case for consistency, improving AI interpretation.
            transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
            complete: (results) => {
                resolve({ kind: 'CSV', name: file.name, size: file.size, status: 'parsed', data: results.data as Record<string, any>[], raw: file });
            },
            error: (error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                resolve({ kind: 'CSV', name: file.name, size: file.size, status: 'error', error: `Erro ao processar CSV: ${message}`, raw: file });
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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'XLSX', name: file.name, size: file.size, status: 'error', error: `Erro ao processar XLSX: ${message}`, raw: file };
    }
};

const handleImage = async (file: File): Promise<ImportedDoc> => {
    try {
        const buffer = await file.arrayBuffer();
        const text = await runOCRFromImage(buffer);
        if (!text.trim()) {
            return { kind: 'IMAGE', name: file.name, size: file.size, status: 'error', error: 'Nenhum texto detectado na imagem (OCR).', raw: file };
        }
         const data = await extractDataFromText(text);
        if (data.length === 0) {
            logger.log('nlpAgent', 'WARN', `Nenhum dado estruturado extraído do texto da imagem ${file.name}`);
        }
        return { kind: 'IMAGE', name: file.name, size: file.size, status: 'parsed', text, data, raw: file };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'IMAGE', name: file.name, size: file.size, status: 'error', error: message, raw: file };
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
        
        let doc: ImportedDoc = { kind: 'PDF', name: file.name, size: file.size, status: 'parsed', text: fullText, raw: file };

        if (fullText.trim().length > 10) { // Check if text was extracted
             const data = await extractDataFromText(fullText);
             if (data.length === 0) {
                logger.log('nlpAgent', 'WARN', `Nenhum dado estruturado extraído do texto do PDF ${file.name}`);
             }
             doc.data = data;
        } else {
            logger.log('ocrExtractor', 'INFO', `PDF ${file.name} sem texto, tentando OCR.`);
            const ocrText = await runOCRFromImage(buffer);
            if (!ocrText.trim()) {
                throw new Error("Documento PDF parece estar vazio ou não contém texto legível (falha no OCR).");
            }
            doc.text = ocrText;
            doc.data = await extractDataFromText(ocrText);
        }
        return doc;

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'PDF', name: file.name, size: file.size, status: 'error', error: `Falha no processamento do PDF: ${message}`, raw: file };
    }
};

const handleUnsupported = (file: File, reason: string): ImportedDoc => ({
    kind: 'UNSUPPORTED', name: file.name, size: file.size, status: 'unsupported', raw: file, error: reason,
});

// --- Main Pipeline ---

const isSupportedExtension = (name: string): boolean => {
    const supportedExtensions = ['.xml', '.csv', '.xlsx', '.xls', '.pdf', '.jpg', '.jpeg', '.png', '.zip'];
    return supportedExtensions.some(ext => name.toLowerCase().endsWith(ext));
};

const processSingleFile = async (file: File): Promise<ImportedDoc> => {
    const sanitizedName = sanitizeFilename(file.name);
    if(sanitizedName !== file.name) {
        logger.log('ImportPipeline', 'WARN', `Nome de arquivo sanitizado: de '${file.name}' para '${sanitizedName}'`);
        // Create a new file with the sanitized name
        file = new File([file], sanitizedName, { type: file.type });
    }

    if (!await checkMagicNumbers(file)) {
        return handleUnsupported(file, 'Assinatura do arquivo (magic number) não corresponde à extensão.');
    }

    const extension = getFileExtension(file.name);
    switch (extension) {
        case 'xml': return handleXML(file);
        case 'csv': return handleCSV(file);
        case 'xlsx': case 'xls': return handleXLSX(file);
        case 'pdf': return handlePDF(file);
        case 'png': case 'jpg': case 'jpeg': return handleImage(file);
        default: return Promise.resolve(handleUnsupported(file, 'Extensão de arquivo não suportada.'));
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
            let result: ImportedDoc | ImportedDoc[];
            const extension = getFileExtension(file.name);

            if (extension === 'zip') {
                try {
                    logger.log('ImportPipeline', 'INFO', `Descompactando arquivo zip: ${file.name}`);
                    const jszip = new JSZip();
                    const zip = await jszip.loadAsync(file);
                    
                    // Get all file-like entries, excluding common metadata folders/files
                    const allFileEntries = Object.values(zip.files).filter(
                        (zipFile: JSZipObject) => !zipFile.dir && !zipFile.name.startsWith('__MACOSX/') && !zipFile.name.endsWith('.DS_Store')
                    );
            
                    const supportedFileEntries = allFileEntries.filter(
                        (zipFile: JSZipObject) => isSupportedExtension(zipFile.name)
                    );
                    
                    // If no supported files are found, create a specific error message.
                    if (supportedFileEntries.length === 0) {
                        let reason = 'O arquivo ZIP está vazio.';
                        if (allFileEntries.length > 0) {
                            const foundFiles = allFileEntries.map(f => f.name).slice(0, 5).join(', ');
                            reason = `O ZIP não contém arquivos com formato suportado. Arquivos encontrados: ${foundFiles}${allFileEntries.length > 5 ? '...' : ''}.`;
                        }
                        // This will be caught by the orchestrator and displayed to the user.
                        result = { kind: 'UNSUPPORTED', name: file.name, size: file.size, status: 'error', error: reason };
            
                    } else {
                        // If there are supported files, process them.
                        const innerDocs = await Promise.all(supportedFileEntries.map(async (zipEntry: JSZipObject) => {
                            const blob = await zipEntry.async('blob');
                            const innerFile = new File([blob], zipEntry.name, { type: blob.type });
                            const doc = await processSingleFile(innerFile);
                            doc.meta = { source_zip: file.name, internal_path: zipEntry.name };
                            return doc;
                        }));
                        result = innerDocs;
                        logger.log('ImportPipeline', 'INFO', `Processados ${innerDocs.length} arquivos de dentro de ${file.name}`);
                    }
            
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    const errorMsg = `Falha ao descompactar ou processar o arquivo ZIP: ${message}`;
                    // FIX: Use file.name for context, as the exception 'e' is of type 'unknown' and may not have a 'name' property.
                    // FIX: Correctly use file.name for logging context as 'e' is of type 'unknown'.
                    logger.log('ImportPipeline', 'ERROR', errorMsg, {fileName: file.name, error: e});
                    result = { kind: 'UNSUPPORTED', name: file.name, size: file.size, status: 'error', error: errorMsg };
                }
            } else if (isSupportedExtension(file.name)) {
                result = await processSingleFile(file);
            } else {
                 result = handleUnsupported(file, 'Extensão de arquivo não suportada.');
            }

            // Log final status of processing
            const logResult = (doc: ImportedDoc) => {
                if (doc.status === 'error' || doc.status === 'unsupported') {
                    logger.log('ImportPipeline', 'ERROR', `Falha ao processar ${doc.name}: ${doc.error}`, { status: doc.status });
                } else {
                     logger.log('ImportPipeline', 'INFO', `Arquivo ${doc.name} processado com sucesso.`);
                }
            };
            Array.isArray(result) ? result.forEach(logResult) : logResult(result);

            progressCounter++;
            onProgress(progressCounter, files.length);
            return result;
        })();
        allDocsPromises.push(promise);
    }

    const results = await Promise.all(allDocsPromises);
    return results.flat();
};