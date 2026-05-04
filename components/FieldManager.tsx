
import React, { useState, useRef, DragEvent, useMemo } from 'react';
import { GripVertical, Trash2, PlusCircle, FilePlus, AlertTriangle } from 'lucide-react';
import { Table, TableData, TableRow } from '../types';

interface FieldManagerProps {
  tables: Table[];
  onUpdate: (tables: Table[]) => void;
}

const FieldManager: React.FC<FieldManagerProps> = ({ tables, onUpdate }) => {
  const [selectedTableId, setSelectedTableId] = useState<string>(tables[0]?.id || '');
  
  const selectedTable = useMemo(() => tables.find(t => t.id === selectedTableId), [tables, selectedTableId]);

  const [newColumnName, setNewColumnName] = useState('');
  const [bulkColumnNames, setBulkColumnNames] = useState('');
  const [error, setError] = useState<string | null>(null);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleDragStart = (e: DragEvent<HTMLLIElement>, index: number) => {
    dragItem.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };
  
  const handleDragEnd = () => {
    if (!selectedTable || dragItem.current === null || dragOverItem.current === null) return;
    
    const newHeaders = [...selectedTable.headers];
    const draggedItemContent = newHeaders.splice(dragItem.current, 1)[0];
    newHeaders.splice(dragOverItem.current, 0, draggedItemContent);
    
    dragItem.current = null;
    dragOverItem.current = null;

    const reorder = (d: TableData) => d.map(row => {
        const newRow: TableRow = {};
        newHeaders.forEach(header => { newRow[header] = row[header]; });
        return newRow;
    });

    const updatedTable = {
        ...selectedTable,
        headers: newHeaders,
        data: reorder(selectedTable.data),
        originalData: reorder(selectedTable.originalData),
    };
    
    onUpdate(tables.map(t => t.id === selectedTableId ? updatedTable : t));
  };
  
  const handleAddColumn = () => {
    if (!selectedTable) return;
    const trimmedName = newColumnName.trim();
    if (!trimmedName) {
      setError("列名不能为空。");
      return;
    }
    if (selectedTable.headers.includes(trimmedName)) {
      setError(`列 "${trimmedName}" 已存在。`);
      return;
    }
    
    const newHeaders = [...selectedTable.headers, trimmedName];
    const updateRow = (row: TableRow) => ({...row, [trimmedName]: null});
    
    const updatedTable = {
        ...selectedTable,
        headers: newHeaders,
        data: selectedTable.data.map(updateRow),
        originalData: selectedTable.originalData.map(updateRow)
    };
    
    onUpdate(tables.map(t => t.id === selectedTableId ? updatedTable : t));
    setNewColumnName('');
    setError(null);
  };
  
  const handleDeleteColumn = (columnName: string) => {
    if (!selectedTable) return;
    const newHeaders = selectedTable.headers.filter(h => h !== columnName);
    const updateRow = (row: TableRow) => {
        const newRow = {...row};
        delete newRow[columnName];
        return newRow;
    };
     const updatedTable = {
        ...selectedTable,
        headers: newHeaders,
        data: selectedTable.data.map(updateRow),
        originalData: selectedTable.originalData.map(updateRow)
    };
    onUpdate(tables.map(t => t.id === selectedTableId ? updatedTable : t));
  };

  const handleBulkAddColumns = () => {
    if (!selectedTable) return;
    const namesToAdd = bulkColumnNames.split('\n')
      .map(name => name.trim())
      .filter(name => name && !selectedTable.headers.includes(name));
    
    const duplicates = bulkColumnNames.split('\n')
      .map(name => name.trim())
      .filter(name => name && selectedTable.headers.includes(name));

    if (namesToAdd.length === 0 && duplicates.length > 0) {
       setError(`所有输入的列 (${duplicates.join(', ')}) 都已存在。`);
       return;
    }
    
    if (duplicates.length > 0) {
        setError(`已跳过存在的列: ${duplicates.join(', ')}。`);
    } else {
        setError(null);
    }

    if (namesToAdd.length > 0) {
      const newHeaders = [...selectedTable.headers, ...namesToAdd];
      const updateRow = (row: TableRow) => {
        const newRow = {...row};
        namesToAdd.forEach(col => newRow[col] = null);
        return newRow;
      };
      const updatedTable = {
        ...selectedTable,
        headers: newHeaders,
        data: selectedTable.data.map(updateRow),
        originalData: selectedTable.originalData.map(updateRow)
      };
      onUpdate(tables.map(t => t.id === selectedTableId ? updatedTable : t));
    }
    setBulkColumnNames('');
  };

  if (!selectedTable) {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 h-full flex items-center justify-center">
            <p className="text-gray-500">请先在自定义表格页面创建表格。</p>
        </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-start">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">字段管理</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                选择一个表格，然后通过拖拽调整列顺序，或在右侧新增、删除列。
                </p>
            </div>
            <select
                value={selectedTableId}
                onChange={e => setSelectedTableId(e.target.value)}
                className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
            >
                {tables.map(table => (
                    <option key={table.id} value={table.id}>{table.name}</option>
                ))}
            </select>
          </div>
      </div>
      <div className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-6 p-4 overflow-auto">
        <div className="md:col-span-2 flex flex-col">
          <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">当前字段 ({selectedTable.headers.length})</h4>
          <div className="flex-grow border border-gray-300 dark:border-gray-600 rounded-lg overflow-y-auto">
            <ul className="divide-y divide-gray-200 dark:divide-gray-600">
              {selectedTable.headers.map((header, index) => (
                <li key={header} className="flex items-center p-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-grab" draggable onDragStart={(e) => handleDragStart(e, index)} onDragEnter={() => handleDragEnter(index)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()} >
                  <GripVertical className="w-5 h-5 mr-3 text-gray-400" />
                  <span className="flex-grow text-sm text-gray-900 dark:text-gray-200">{header}</span>
                  <button onClick={() => handleDeleteColumn(header)} className="text-red-500 hover:text-red-700 dark:hover:text-red-400" aria-label={`Delete column ${header}`} >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="md:col-span-1 space-y-6">
          <div>
            <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">新增字段</h4>
             {error && (
              <div className="mb-2 p-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-sm rounded-md flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0" />
                  <span>{error}</span>
              </div>
            )}
            <div className="flex gap-2">
              <input type="text" value={newColumnName} onChange={(e) => { setNewColumnName(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddColumn(); } }} placeholder="输入新列名" className="flex-grow bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2" />
              <button onClick={handleAddColumn} className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700" >
                <PlusCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div>
            <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">批量新增</h4>
            <textarea value={bulkColumnNames} onChange={(e) => setBulkColumnNames(e.target.value)} placeholder="每行一个新列名..." rows={5} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2" />
            <button onClick={handleBulkAddColumns} className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-500 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600" >
              <FilePlus className="w-5 h-5 mr-1" />
              批量添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FieldManager;
