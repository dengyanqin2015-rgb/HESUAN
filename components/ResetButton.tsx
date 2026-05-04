import React from 'react';
import { RotateCcw } from 'lucide-react';

interface ResetButtonProps {
  onReset: () => void;
  disabled: boolean;
}

const ResetButton: React.FC<ResetButtonProps> = ({ onReset, disabled }) => {
  return (
    <button
      onClick={onReset}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-gray-800 dark:text-white bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:text-white dark:disabled:text-gray-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 dark:focus:ring-offset-gray-800 transition-colors duration-300"
    >
      <RotateCcw className="h-4 w-4" />
      <span>重置</span>
    </button>
  );
};

export default ResetButton;
