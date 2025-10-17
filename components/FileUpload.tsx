import React, { useState, useCallback } from 'react';
import { UploadIcon, FileIcon } from './icons';

interface FileUploadProps {
  onFileUpload: (files: FileList) => void;
  disabled: boolean;
}

const FILE_SIZE_LIMIT_MB = 200;
const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MB * 1024 * 1024;

const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const processFiles = (files: FileList) => {
      setError(null);
      const acceptedFiles: File[] = [];
      for (const file of Array.from(files)) {
          if (file.size > FILE_SIZE_LIMIT_BYTES) {
              setError(`O arquivo ${file.name} excede o limite de ${FILE_SIZE_LIMIT_MB} MB.`);
              // continue processing other files
          } else {
              acceptedFiles.push(file);
          }
      }
      if (acceptedFiles.length > 0) {
        const dataTransfer = new DataTransfer();
        acceptedFiles.forEach(file => dataTransfer.items.add(file));
        onFileUpload(dataTransfer.files);
        setUploadedFiles(acceptedFiles);
      }
  };

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!disabled && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [disabled, onFileUpload]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled && e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = ''; // Reset input to allow re-uploading the same file
    }
  };

  const handleDemoFile = () => {
    if (disabled) return;
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00" Id="NFe35240101234567890123550010000001231000001234">
        <ide>
        <dhEmi>2024-05-20T10:00:00-03:00</dhEmi>
        </ide>
        <emit>
        <xNome>Nexus Tech Solutions LTDA</xNome>
        </emit>
        <dest>
        <xNome>Quantum Innovations S.A.</xNome>
        </dest>
        <det nItem="1">
        <prod>
            <cProd>P001</cProd>
            <xProd>PROCESSADOR QUÂNTICO I2A2</xProd>
            <NCM>84715010</NCM>
            <CFOP>5101</CFOP>
            <qCom>2.0000</qCom>
            <vUnCom>75000.00</vUnCom>
            <vProd>150000.00</vProd>
        </prod>
        </det>
        <det nItem="2">
        <prod>
            <cProd>P002</cProd>
            <xProd>PLACA DE CRIPTOGRAFIA AVANÇADA</xProd>
            <NCM>85423190</NCM>
            <CFOP>5101</CFOP>
            <qCom>10.0000</qCom>
            <vUnCom>12500.00</vUnCom>
            <vProd>125000.00</vProd>
        </prod>
        </det>
        <det nItem="3">
        <prod>
            <cProd>S001</cProd>
            <xProd>CONSULTORIA EM ANÁLISE FISCAL</xProd>
            <NCM>00000000</NCM>
            <CFOP>5933</CFOP>
            <qCom>50.0000</qCom>
            <vUnCom>800.00</vUnCom>
            <vProd>40000.00</vProd>
        </prod>
        </det>
        <total>
        <ICMSTot>
            <vNF>315000.00</vNF>
        </ICMSTot>
        </total>
    </infNFe>
    </NFe>
</nfeProc>`;
    const demoFile = new File([mockXml], "NFe_Demonstracao.xml", { type: "text/xml" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(demoFile);
    onFileUpload(dataTransfer.files);
    setUploadedFiles([demoFile]);
  };

  const fileTypes = ".xml,.csv,.xlsx,.pdf,.png,.jpeg,.jpg,.zip,application/zip,application/x-zip-compressed";

  const containerClasses = `
    border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300
    ${disabled ? 'bg-gray-800/50 border-gray-700 cursor-not-allowed' :
      isDragging ? 'bg-blue-900/30 border-blue-400 scale-105' :
      'bg-gray-800/50 border-gray-600 hover:border-blue-500 hover:bg-gray-800'
    }
  `;

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
      <h2 className="text-xl font-bold mb-4 text-gray-200">1. Upload de Arquivos</h2>
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={containerClasses}
      >
        <input
          type="file"
          id="file-upload"
          className="hidden"
          multiple
          accept={fileTypes}
          onChange={handleFileChange}
          disabled={disabled}
        />
        <label htmlFor="file-upload" className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
          <div className="flex flex-col items-center justify-center">
            <UploadIcon className={`w-12 h-12 mb-4 ${disabled ? 'text-gray-600' : 'text-gray-400'}`} />
            <p className={`font-semibold ${disabled ? 'text-gray-500' : 'text-blue-400'}`}>
              Clique ou arraste seus arquivos
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Suportados: XML, CSV, XLSX, PDF, Imagens (PNG, JPG), ZIP
            </p>
          </div>
        </label>
      </div>
       <div className="text-center mt-4">
          <button
              onClick={handleDemoFile}
              disabled={disabled}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors underline"
          >
              Não tem um arquivo? Use um exemplo de demonstração.
          </button>
      </div>
       {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
       {uploadedFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Arquivos selecionados:</h3>
          <ul className="max-h-32 overflow-y-auto space-y-1 pr-2">
            {uploadedFiles.map((file, index) => (
              <li key={index} className="flex items-center justify-between text-xs bg-gray-700/50 p-2 rounded">
                <div className="flex items-center truncate">
                    <FileIcon className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                    <span className="truncate text-gray-300">{file.name}</span>
                </div>
                <span className="text-gray-400 flex-shrink-0 ml-2">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FileUpload;