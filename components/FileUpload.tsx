import React, { useRef } from 'react';
import { UploadCloud } from 'lucide-react';

interface FileUploadProps {
  onFileUpload: (file: File) => void;
  disabled: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      onFileUpload(files[0]);
       if(fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onButtonClick}
        disabled={disabled}
        className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition-colors duration-300"
      >
        <UploadCloud className="h-4 w-4" />
        <span>上传</span>
      </button>
    </>
  );
};

export default FileUpload;
