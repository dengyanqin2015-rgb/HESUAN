import React from 'react';
import { Download } from 'lucide-react';

interface DownloadButtonProps {
  onDownload: () => void;
  disabled: boolean;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ onDownload, disabled }) => {
  return (
    <button
      onClick={onDownload}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:focus:ring-offset-gray-800 transition-colors duration-300"
    >
      <Download className="h-4 w-4" />
      <span>下载</span>
    </button>
  );
};

export default DownloadButton;
