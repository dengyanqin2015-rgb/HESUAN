import React, { useRef, useEffect, useState, useCallback } from 'react';
import { TableData } from '../types';
import { Maximize, Minimize, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';


interface DataTableProps {
  data: TableData;
  headers: string[];
  fileName: string | null;
  totalRows: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const DataTable: React.FC<DataTableProps> = ({ 
  data, 
  headers,
  fileName,
  totalRows,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange
}) => {
  const fullScreenContainerRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  const pageCount = Math.ceil(totalRows / pageSize);

  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);
  
  const toggleFullScreen = () => {
    if (!fullScreenContainerRef.current) return;
    if (!document.fullscreenElement) {
      fullScreenContainerRef.current.requestFullscreen().catch(err => {
        alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  };
  
  const goToPage = (pageNumber: number) => {
    const newPage = Math.max(1, Math.min(pageCount, pageNumber));
    onPageChange(newPage);
  };


  if (totalRows === 0) {
    return null;
  }

  const Pagination = () => (
    <div className="flex-shrink-0 flex items-center justify-between p-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">每页行数:</span>
            <select
                value={pageSize}
                onChange={e => onPageSizeChange(Number(e.target.value))}
                className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block p-1"
            >
                {[50, 100, 200, 500].map(size => (
                    <option key={size} value={size}>{size}</option>
                ))}
            </select>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">
                第 {currentPage.toLocaleString()} / {pageCount.toLocaleString()} 页
            </span>
             <div className="flex items-center gap-1">
                <button onClick={() => goToPage(1)} disabled={currentPage === 1} className="p-1.5 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronsLeft className="h-4 w-4" /></button>
                <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-1.5 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronLeft className="h-4 w-4" /></button>
                <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pageCount} className="p-1.5 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronRight className="h-4 w-4" /></button>
                <button onClick={() => goToPage(pageCount)} disabled={currentPage === pageCount} className="p-1.5 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronsRight className="h-4 w-4" /></button>
             </div>
        </div>
    </div>
  );

  return (
    <div ref={fullScreenContainerRef} className="w-full h-full flex flex-col bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                数据预览: <span className="text-blue-600 dark:text-blue-400 font-mono">{fileName}</span>
                <span className="ml-4 text-sm font-normal text-gray-500 dark:text-gray-400">({totalRows.toLocaleString()} 行)</span>
            </h2>
            <button onClick={toggleFullScreen} className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                {isFullScreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
        </div>
        <div className="flex-grow overflow-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
                <tr>
                    {headers.map((header) => (
                    <th
                        key={header}
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap"
                    >
                        {header}
                    </th>
                    ))}
                </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {data.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-gray-50 dark:hover:bg-gray-700/20">
                        {headers.map((header) => (
                            <td key={`${rowIndex}-${header}`} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                            {row[header]?.toString() ?? ''}
                            </td>
                        ))}
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
        <Pagination />
    </div>
  );
};

export default DataTable;