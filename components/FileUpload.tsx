import React, { useState, useCallback } from 'react';
import { UploadIcon, FileIcon } from './icons';

interface FileUploadProps {
  onFileUpload: (files: FileList) => void;
  disabled: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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
      onFileUpload(e.dataTransfer.files);
      setUploadedFiles(Array.from(e.dataTransfer.files));
    }
  }, [disabled, onFileUpload]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled && e.target.files && e.target.files.length > 0) {
      onFileUpload(e.target.files);
      setUploadedFiles(Array.from(e.target.files));
      e.target.value = ''; // Reset input to allow re-uploading the same file
    }
  };

  const fileTypes = ".zip";

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
              Clique para selecionar ou arraste seus arquivos ZIP
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Arquivos suportados: ZIP (contendo arquivos .csv)
            </p>
          </div>
        </label>
      </div>
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