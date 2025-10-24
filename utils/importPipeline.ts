import { logger } from '../services/logger';
import { parseSafeFloat } from './parsingUtils';
import { runOCR } from '../services/ocrService';
import { sanitizeRecords } from '../services/sanitizationService';
import { measureExecution, telemetry } from '../services/telemetry';
import { extractDataFromText } from '../agents/nlpAgent';
import type { ImportedDoc } from '../types';

import JSZip, { type JSZipObject } from 'jszip';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@^4.8.69/build/pdf.worker.mjs`;

const getFileExtension = (filename: string): string => filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase();

const sanitizeFilename = (filename: string): string => filename.replace(/[^a-zA-Z0-9._-]/g, '_');

const getXmlValue = (field: any): any => {
  if (field === null || field === undefined) return undefined;
  if (typeof field === 'object') {
    if (field['#text'] !== undefined) return field['#text'];
    if (Object.keys(field).length === 0) return undefined;
  }
  return field;
};

const getInnerTaxBlock = (taxParent: any): any => {
  if (!taxParent || typeof taxParent !== 'object') {
    return {};
  }
  const keys = Object.keys(taxParent);
  if (keys.length > 0) {
    const innerKey = keys.find(k => typeof taxParent[k] === 'object' && taxParent[k] !== null);
    if (innerKey) {
      return taxParent[innerKey];
    }
  }
  return {};
};

const normalizeNFeData = (nfeData: any): Record<string, any>[] => {
  const infNFe = nfeData?.nfeProc?.NFe?.infNFe || nfeData?.NFe?.infNFe || nfeData?.infNFe;
  if (!infNFe) {
    logger.log('ImportPipeline', 'ERROR', 'Bloco <infNFe> não encontrado no XML.');
    return [];
  }

  const items = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : []);
  if (items.length === 0) {
    logger.log('ImportPipeline', 'WARN', 'Nenhum item <det> encontrado no XML.');
    return [];
  }

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const dest = infNFe.dest || {};
  const total = infNFe.total || {};
  const icmsTot = total.ICMSTot || {};
  const issqnTot = total.ISSQNtot || {};

  const nfeId = infNFe['@_Id'];
  if (!nfeId) {
    logger.log('ImportPipeline', 'ERROR', 'Atributo "Id" da NFe não foi encontrado em <infNFe>.');
  }

  let nfeTotalValue = parseSafeFloat(getXmlValue(icmsTot.vNF));
  if (nfeTotalValue === 0) {
    const totalProducts = parseSafeFloat(getXmlValue(icmsTot.vProd));
    const totalServices = parseSafeFloat(getXmlValue(issqnTot.vServ));
    nfeTotalValue = totalProducts + totalServices;
    if (nfeTotalValue > 0) {
      logger.log('ImportPipeline', 'WARN', `vNF ausente/zerado na NFe ${nfeId}. Total reconstruído: R$ ${nfeTotalValue}`);
    }
  }

  return items.map((item: any) => {
    const prod = item.prod || {};
    const imposto = item.imposto || {};
    const icmsBlock = getInnerTaxBlock(imposto.ICMS);
    const pisBlock = getInnerTaxBlock(imposto.PIS);
    const cofinsBlock = getInnerTaxBlock(imposto.COFINS);
    const issqnBlock = imposto.ISSQN || {};
    const enderEmit = emit.enderEmit || {};
    const enderDest = dest.enderDest || {};

    return {
      nfe_id: nfeId,
      data_emissao: getXmlValue(ide.dhEmi),
      valor_total_nfe: nfeTotalValue,
      emitente_nome: getXmlValue(emit.xNome),
      emitente_cnpj: getXmlValue(emit.CNPJ),
      emitente_uf: getXmlValue(enderEmit.UF),
      destinatario_nome: getXmlValue(dest.xNome),
      destinatario_cnpj: getXmlValue(dest.CNPJ),
      destinatario_uf: getXmlValue(enderDest.UF),
      produto_nome: getXmlValue(prod.xProd),
      produto_ncm: getXmlValue(prod.NCM),
      produto_cfop: getXmlValue(prod.CFOP),
      produto_cst_icms: getXmlValue(icmsBlock.CST),
      produto_base_calculo_icms: parseSafeFloat(getXmlValue(icmsBlock.vBC)),
      produto_aliquota_icms: parseSafeFloat(getXmlValue(icmsBlock.pICMS)),
      produto_valor_icms: parseSafeFloat(getXmlValue(icmsBlock.vICMS)),
      produto_cst_pis: getXmlValue(pisBlock.CST),
      produto_valor_pis: parseSafeFloat(getXmlValue(pisBlock.vPIS)),
      produto_cst_cofins: getXmlValue(cofinsBlock.CST),
      produto_valor_cofins: parseSafeFloat(getXmlValue(cofinsBlock.vCOFINS)),
      produto_valor_iss: parseSafeFloat(getXmlValue(issqnBlock.vISSQN)),
      produto_qtd: parseSafeFloat(getXmlValue(prod.qCom)),
      produto_valor_unit: parseSafeFloat(getXmlValue(prod.vUnCom)),
      produto_valor_total: parseSafeFloat(getXmlValue(prod.vProd)),
    };
  });
};

const handleXML = async (file: File): Promise<ImportedDoc> => {
  try {
    const { XMLParser } = await import('fast-xml-parser');
    const text = await file.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      allowBooleanAttributes: true,
      parseTagValue: false,
      parseAttributeValue: false,
    });
    const jsonObj = parser.parse(text);
    const rawData = normalizeNFeData(jsonObj);
    const data = await sanitizeRecords(rawData);

    if (data.length === 0) {
      return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'error', error: 'Nenhum item de produto encontrado no XML ou XML malformado.', raw: file };
    }
    return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'parsed', data, raw: file };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.log('ImportPipeline', 'ERROR', `Erro crítico ao processar XML: ${file.name}`, { error });
    return { kind: 'NFE_XML', name: file.name, size: file.size, status: 'error', error: `Erro ao processar XML: ${message}`, raw: file };
  }
};

const handleCSV = (file: File): Promise<ImportedDoc> => new Promise(resolve => {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: header => header.trim().toLowerCase().replace(/\s+/g, '_'),
    complete: async results => {
      const sanitized = await sanitizeRecords(results.data as Record<string, any>[]);
      resolve({ kind: 'CSV', name: file.name, size: file.size, status: 'parsed', data: sanitized, raw: file });
    },
    error: error => {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ kind: 'CSV', name: file.name, size: file.size, status: 'error', error: `Erro ao processar CSV: ${message}`, raw: file });
    },
  });
});

const handleXLSX = async (file: File): Promise<ImportedDoc> => {
  try {
    const { read, utils } = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = utils.sheet_to_json(worksheet) as Record<string, any>[];
    const sanitized = await sanitizeRecords(data);
    return { kind: 'XLSX', name: file.name, size: file.size, status: 'parsed', data: sanitized, raw: file };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'XLSX', name: file.name, size: file.size, status: 'error', error: `Erro ao processar XLSX: ${message}`, raw: file };
  }
};

const handleImage = async (file: File, correlationId: string): Promise<ImportedDoc> => {
  try {
    const buffer = await file.arrayBuffer();
    const text = await runOCR(buffer, file.name);
    if (!text.trim()) {
      return { kind: 'IMAGE', name: file.name, size: file.size, status: 'error', error: 'Nenhum texto detectado na imagem (OCR).', raw: file };
    }
    const data = await extractDataFromText(text, correlationId);
    const sanitizedData = data.length > 0 ? await sanitizeRecords(data) : data;
    if (sanitizedData.length === 0) {
      logger.log('nlpAgent', 'WARN', `Nenhum dado estruturado extraído do texto da imagem ${file.name}`, undefined, {
        correlationId,
        scope: 'agent',
      });
    }
    return { kind: 'IMAGE', name: file.name, size: file.size, status: 'parsed', text, data: sanitizedData, raw: file };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'IMAGE', name: file.name, size: file.size, status: 'error', error: message, raw: file };
  }
};

const handlePDF = async (file: File, correlationId: string): Promise<ImportedDoc> => {
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

    if (fullText.trim().length > 10) {
      const data = await extractDataFromText(fullText, correlationId);
      const sanitizedData = data.length > 0 ? await sanitizeRecords(data) : data;
      if (sanitizedData.length === 0) {
        logger.log('nlpAgent', 'WARN', `Nenhum dado estruturado extraído do texto do PDF ${file.name}`, undefined, {
          correlationId,
          scope: 'agent',
        });
      }
      doc.data = sanitizedData;
    } else {
      logger.log('ocrExtractor', 'INFO', `PDF ${file.name} sem texto, tentando OCR.`);
      const ocrText = await runOCR(buffer, file.name);
      if (!ocrText.trim()) {
        throw new Error('Documento PDF vazio ou ilegível (falha no OCR).');
      }
      doc.text = ocrText;
      const extracted = await extractDataFromText(ocrText, correlationId);
      doc.data = extracted.length > 0 ? await sanitizeRecords(extracted) : extracted;
    }
    return doc;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'PDF', name: file.name, size: file.size, status: 'error', error: `Falha no processamento do PDF: ${message}`, raw: file };
  }
};

const handleUnsupported = (file: File, reason: string): ImportedDoc => ({
  kind: 'UNSUPPORTED',
  name: file.name,
  size: file.size,
  status: 'unsupported',
  raw: file,
  error: reason,
});

const isSupportedExtension = (name: string): boolean => {
  const supportedExtensions = ['.xml', '.csv', '.xlsx', '.xls', '.pdf', '.jpg', '.jpeg', '.png', '.zip'];
  return supportedExtensions.some(ext => name.toLowerCase().endsWith(ext));
};

const processSingleFile = async (file: File, correlationId: string): Promise<ImportedDoc> => {
  return measureExecution('ocr', 'import.processSingle', async () => {
    let workingFile = file;
    const sanitizedName = sanitizeFilename(workingFile.name);
    if (sanitizedName !== workingFile.name) {
      logger.log('ImportPipeline', 'WARN', `Nome de arquivo sanitizado: '${workingFile.name}' -> '${sanitizedName}'`, undefined, {
        correlationId,
        scope: 'backend',
      });
      workingFile = new File([workingFile], sanitizedName, { type: workingFile.type });
    }

    const extension = getFileExtension(workingFile.name);
    switch (extension) {
      case 'xml':
        return handleXML(workingFile);
      case 'csv':
        return handleCSV(workingFile);
      case 'xlsx':
      case 'xls':
        return handleXLSX(workingFile);
      case 'pdf':
        return handlePDF(workingFile, correlationId);
      case 'png':
      case 'jpg':
      case 'jpeg':
        return handleImage(workingFile, correlationId);
      default:
        return handleUnsupported(workingFile, 'Extensão de arquivo não suportada.');
    }
  }, { correlationId, attributes: { file: file.name } });
};

export const importFiles = async (
  files: File[],
  onProgress: (current: number, total: number) => void,
  correlationId?: string,
): Promise<ImportedDoc[]> => {
  const cid = correlationId || telemetry.createCorrelationId('backend');
  const allDocsPromises: Promise<ImportedDoc | ImportedDoc[]>[] = [];
  let progressCounter = 0;

  onProgress(0, files.length);

  for (const file of files) {
    const promise = (async () => {
      let result: ImportedDoc | ImportedDoc[];
      const extension = getFileExtension(file.name);

      if (extension === 'zip') {
        try {
          logger.log('ImportPipeline', 'INFO', `Descompactando arquivo zip: ${file.name}`, undefined, {
            correlationId: cid,
            scope: 'backend',
          });
          const jszip = new JSZip();
          const zip = await jszip.loadAsync(file);
          const allFileEntries = Object.values(zip.files).filter(
            (zipFile: JSZipObject) => !zipFile.dir && !zipFile.name.startsWith('__MACOSX/') && !zipFile.name.endsWith('.DS_Store'),
          );

          const supportedFileEntries = allFileEntries.filter(entry => isSupportedExtension(entry.name));
          if (supportedFileEntries.length === 0) {
            let reason = 'O arquivo ZIP está vazio.';
            if (allFileEntries.length > 0) {
              const foundFiles = allFileEntries.map(f => f.name).slice(0, 5).join(', ');
              reason = `O ZIP não contém arquivos com formato suportado. Arquivos encontrados: ${foundFiles}${allFileEntries.length > 5 ? '...' : ''}.`;
            }
            result = { kind: 'UNSUPPORTED', name: file.name, size: file.size, status: 'error', error: reason };
          } else {
            const innerDocs = await Promise.all(supportedFileEntries.map(async zipEntry => {
              const blob = await zipEntry.async('blob');
              const innerFile = new File([blob], zipEntry.name, { type: blob.type });
              const doc = await processSingleFile(innerFile, cid);
              doc.meta = { source_zip: file.name, internal_path: zipEntry.name };
              return doc;
            }));
            result = innerDocs;
            logger.log('ImportPipeline', 'INFO', `Processados ${innerDocs.length} arquivos internos de ${file.name}`, undefined, {
              correlationId: cid,
              scope: 'backend',
            });
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          const errorMsg = `Falha ao descompactar ou processar o arquivo ZIP: ${message}`;
          logger.log('ImportPipeline', 'ERROR', errorMsg, { fileName: file.name, error: e }, {
            correlationId: cid,
            scope: 'backend',
          });
          result = { kind: 'UNSUPPORTED', name: file.name, size: file.size, status: 'error', error: errorMsg };
        }
      } else if (isSupportedExtension(file.name)) {
        result = await processSingleFile(file, cid);
      } else {
        result = handleUnsupported(file, 'Extensão de arquivo não suportada.');
      }

      const logResult = (doc: ImportedDoc) => {
        if (doc.status === 'error' || doc.status === 'unsupported') {
          logger.log('ImportPipeline', 'ERROR', `Falha ao processar ${doc.name}: ${doc.error}`, { status: doc.status }, {
            correlationId: cid,
            scope: 'backend',
          });
        } else {
          logger.log('ImportPipeline', 'INFO', `Arquivo ${doc.name} processado com sucesso.`, undefined, {
            correlationId: cid,
            scope: 'backend',
          });
        }
      };
      if (Array.isArray(result)) {
        result.forEach(logResult);
      } else {
        logResult(result);
      }

      progressCounter++;
      onProgress(progressCounter, files.length);
      return result;
    })();
    allDocsPromises.push(promise);
  }

  const results = await Promise.all(allDocsPromises);
  telemetry.recordThroughput('ocr', 'import.pipeline', results.length, { files: files.length });
  return results.flat();
};
