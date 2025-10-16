import type { NfeData, JSZipObject } from '../types';

const MAX_SAMPLE_ROWS = 200;

/**
 * Finds all .csv files within a JSZip instance.
 * @param zip The JSZip instance.
 * @returns An array of JSZipObject representing the CSV files.
 */
const findCsvFiles = (zip: any): JSZipObject[] => {
  const csvFiles: JSZipObject[] = [];
  zip.forEach((relativePath: string, file: JSZipObject) => {
    if (!file.dir && relativePath.toLowerCase().endsWith('.csv')) {
      csvFiles.push(file);
    }
  });
  return csvFiles;
};

/**
 * Processes a list of uploaded files, expecting ZIP archives containing CSVs.
 * It unzips, parses CSVs, aggregates data, and creates a data sample.
 * @param files The FileList from a file input.
 * @param onProgress A callback to report progress.
 * @returns A promise that resolves to an NfeData object.
 */
export const processFiles = async (
  files: FileList,
  onProgress: (current: number, total: number) => void
): Promise<NfeData> => {
  if (!window.JSZip || !window.Papa) {
    throw new Error('As bibliotecas JSZip ou PapaParse não foram carregadas. Verifique sua conexão com a internet.');
  }

  let allCsvData: any[] = [];
  const fileDetails: { name: string; size: number }[] = [];
  let totalSize = 0;
  let fileCount = 0;
  
  const zipFiles = Array.from(files).filter(file => file.name.toLowerCase().endsWith('.zip'));

  if (zipFiles.length === 0) {
      throw new Error("Nenhum arquivo .zip encontrado. Por favor, envie um arquivo ZIP contendo seus arquivos CSV.");
  }
  
  onProgress(0, zipFiles.length);

  for (let i = 0; i < zipFiles.length; i++) {
    const zipFile = zipFiles[i];
    try {
      const zip = await window.JSZip.loadAsync(zipFile);
      const csvFiles = findCsvFiles(zip);

      if (csvFiles.length === 0) {
        console.warn(`Nenhum arquivo CSV encontrado em ${zipFile.name}`);
        // This is not an error, just an empty zip. We can continue.
      }

      for (const csvFile of csvFiles) {
        const csvString = await csvFile.async('string');
        
        const parsed = await new Promise<any>((resolve, reject) => {
            window.Papa.parse(csvString, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => resolve(results),
                error: (error) => reject(error),
            });
        });

        if (parsed.errors.length > 0) {
            console.warn(`Erros ao analisar ${csvFile.name}:`, parsed.errors.map((e: any) => e.message).join(', '));
        }
        
        if (parsed.data && parsed.data.length > 0) {
            allCsvData.push(...parsed.data);
            fileDetails.push({ name: csvFile.name, size: csvString.length });
            totalSize += csvString.length;
            fileCount++;
        }
      }
    } catch (error: any) {
      console.error(`Erro ao processar o arquivo zip ${zipFile.name}:`, error);
      throw new Error(`Falha ao processar o arquivo ZIP: ${zipFile.name}. Verifique se o arquivo não está corrompido.`);
    }
    onProgress(i + 1, zipFiles.length);
  }

  if (fileCount === 0) {
    throw new Error('Nenhum arquivo CSV foi encontrado dentro dos arquivos ZIP fornecidos.');
  }

  // Create a sample CSV string from the first N rows.
  const dataSampleArray = allCsvData.slice(0, MAX_SAMPLE_ROWS);
  // Papa.unparse will automatically use object keys as headers.
  const dataSample = window.Papa.unparse(dataSampleArray);

  return {
    fileCount,
    totalSize,
    fileDetails,
    dataSample,
  };
};
