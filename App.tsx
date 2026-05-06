
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { TableData, RuleGroup, TableRow, FilterCondition, RuleCategory, Table, MultiMatchRule, AllocationAction } from './types';
import FileUpload from './components/FileUpload';
import DataTable from './components/DataTable';
import DownloadButton from './components/DownloadButton';
import ResetButton from './components/ResetButton';
import AllocationForm from './components/AllocationForm';
import FieldManager from './components/FieldManager';
import { UploadCloud, Loader, AlertTriangle, Calculator, X, FileUp, FileDown, Download, FilePlus, Table as TableIcon, SlidersHorizontal, Baseline, Edit, Trash, Copy as CopyIcon, Save, PlusCircle as PlusCircleIcon, Settings2 } from 'lucide-react';


declare const XLSX: any;
const DATA_STORAGE_KEY = 'xlsx-data-handler-rules-v5-multitable'; 

const workerScript = `
self.importScripts('https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js');

self.onmessage = function(e) {
    var type = e.data.type;
    var payload = e.data.payload;

    try {
        if (type === 'PARSE_FILE') {
            var file = payload.file;
            var fileName = payload.fileName;
            var tableId = payload.tableId;

            file.arrayBuffer().then(function(arrayBuffer) {
                try {
                    var data = new Uint8Array(arrayBuffer);
                    var workbook = XLSX.read(data, { type: 'array' });
                    var sheetName = workbook.SheetNames[0];
                    var worksheet = workbook.Sheets[sheetName];
                    var jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    if (!Array.isArray(jsonData) || jsonData.length === 0 || !Array.isArray(jsonData[0]) || jsonData[0].length === 0) {
                         throw new Error("表格为空、没有表头或格式不正确。");
                    }

                    var headers = jsonData[0].map(String);
                    var dataRows = jsonData.slice(1).map(function(row) {
                        var rowData = {};
                        headers.forEach(function(header, index) { 
                            rowData[header] = row[index] === undefined ? null : row[index]; 
                        });
                        return rowData;
                    });
                    self.postMessage({ 
                        type: 'PARSE_SUCCESS', 
                        payload: { 
                            data: dataRows, 
                            headers: headers, 
                            fileName: fileName,
                            tableId: tableId
                        } 
                    });
                } catch (err) {
                     self.postMessage({ type: 'ERROR', error: err.message || '解析文件时发生内部错误' });
                }
            }).catch(function(err){
                self.postMessage({ type: 'ERROR', error: '读取文件内容时出错: ' + (err.message || '未知错误') });
            });
        } else if (type === 'APPLY_RULES') {
            var tables = payload.tables;
            var activeRuleGroups = payload.activeRuleGroups;
            var apiKey = payload.apiKey;

            if (!tables || tables.length === 0 || !tables[0].originalData) {
              self.postMessage({ type: 'ERROR', error: '没有提供可处理的数据。' });
              return;
            }
            
            var mainTable = tables[0];
            var processedData = JSON.parse(JSON.stringify(mainTable.originalData));
            
            var newColumnNames = {};
            activeRuleGroups.forEach(function(group) {
                if (group.action && (group.action.newColumnName || (group.action.type === 'lookup_value' && group.action.newColumnName))) {
                    newColumnNames[group.action.newColumnName] = true;
                }
            });
            var columnsToAdd = Object.keys(newColumnNames);

            if (processedData.length > 0 && columnsToAdd.length > 0) {
                processedData.forEach(function(row) {
                    columnsToAdd.forEach(function(colName) {
                        if (!(colName in row)) {
                            row[colName] = null;
                        }
                    });
                });
            }

            var normalize = function(val) {
                if (val === null || val === undefined) return '';
                return String(val)
                    .replace(/[\s\uFEFF\xA0]+/g, ' ') 
                    .trim()
                    .toLowerCase();
            };

            var checkRow = function(row, filters, forTable) {
                if (!filters || filters.length === 0) return true;
                
                var checkCondition = function(filter) {
                    var cellValue = row[filter.column] === null || row[filter.column] === undefined ? '' : String(row[filter.column]);
                    var cellValueStr = normalize(cellValue);
                    var filterValueStr = normalize(filter.value || '');
                    switch (filter.operator) {
                        case 'contains': return cellValueStr.indexOf(filterValueStr) !== -1;
                        case 'not_contains': return cellValueStr.indexOf(filterValueStr) === -1;
                        case 'equals': return cellValueStr === filterValueStr;
                        case 'not_equals': return cellValueStr !== filterValueStr;
                        case 'is_empty': return cellValue === null || cellValueStr === '';
                        case 'is_not_empty': return cellValue !== null && cellValueStr !== '';
                        default: return true;
                    }
                };
                
                var result = checkCondition(filters[0]);
                for (var i = 1; i < filters.length; i++) {
                    var conditionResult = checkCondition(filters[i]);
                    var logic = filters[i].logic || 'and';
                    if (logic === 'and') {
                        result = result && conditionResult;
                    } else {
                        result = result || conditionResult;
                    }
                }
                return result;
            };
            
            var ai = null;
            var hasAiRules = activeRuleGroups.some(function(g) { return g.action.type === 'ai_formula'; });
            if (hasAiRules && apiKey) {
                try {
                    self.importScripts('https://aistudiocdn.com/@google/genai');
                    ai = new self.GoogleGenAI({ apiKey: apiKey });
                } catch(err) {
                    self.postMessage({ type: 'ERROR', error: '加载 AI 模块失败: ' + err.message + '. 可能需要更新 AI 库。' });
                    return;
                }
            }

            var maxRetries = 10;
            var currentRetry = 0;
            var previousDataSnapshot = JSON.stringify(processedData);

            var processRulesSequentially = function(ruleIndex) {
                if (ruleIndex >= activeRuleGroups.length) {
                    var currentDataSnapshot = JSON.stringify(processedData);
                    if (currentDataSnapshot !== previousDataSnapshot && currentRetry < maxRetries) {
                        currentRetry++;
                        previousDataSnapshot = currentDataSnapshot;
                        self.postMessage({ type: 'APPLY_RULES_PROGRESS', payload: { progress: 1, message: '数据发生变化，进行第 ' + currentRetry + ' 次重试核算...' } });
                        setTimeout(function() {
                            processRulesSequentially(0);
                        }, 50);
                        return;
                    }
                    self.postMessage({ type: 'APPLY_RULES_SUCCESS', payload: { processedData: processedData } });
                    return;
                }

                var group = activeRuleGroups[ruleIndex];
                var action = group.action;
                var progressPayload = { progress: (ruleIndex + 1) / activeRuleGroups.length, message: '正在应用规则 ' + (ruleIndex + 1) + '/' + activeRuleGroups.length + ': ' + group.name };
                self.postMessage({ type: 'APPLY_RULES_PROGRESS', payload: progressPayload });

                if (action.type === 'distribute_amount') {
                    var totalAmount;
                    if (action.sourceType === 'cell' && action.cellSource) {
                        var source = action.cellSource;
                        var targetTable = tables.find(function(t) { return t.id === source.tableId; });
                        if (!targetTable) {
                           console.error('Rule "' + group.name + '": Source table with ID ' + source.tableId + ' not found.');
                           processRulesSequentially(ruleIndex + 1);
                           return;
                        }
                        var matchingRowsInSource = targetTable.data.filter(function(row) { return checkRow(row, source.filters, targetTable); });
                        if (matchingRowsInSource.length === 1) {
                            var val = matchingRowsInSource[0][source.column];
                            if (val !== undefined && val !== null && !isNaN(parseFloat(String(val)))) {
                                totalAmount = parseFloat(String(val));
                            } else {
                                console.error('Rule "' + group.name + '": Cell value is not a number.');
                            }
                        } else {
                            console.error('Rule "' + group.name + '": Found ' + matchingRowsInSource.length + ' rows in source, expected 1.');
                        }
                    } else {
                        totalAmount = action.totalAmount;
                    }
                    
                    if (totalAmount !== undefined) {
                        var matchingRows = processedData.filter(function(row) { return checkRow(row, group.filters, mainTable); });
                        var amount = matchingRows.length > 0 ? parseFloat((totalAmount / matchingRows.length).toFixed(3)) : 0;
                        processedData.forEach(function(row) { if (checkRow(row, group.filters, mainTable)) { row[action.newColumnName] = amount; } });
                    }
                    processRulesSequentially(ruleIndex + 1);

                } else if (action.type === 'fill_text') {
                    processedData.forEach(function(row) { if (checkRow(row, group.filters, mainTable)) { row[action.newColumnName] = action.fillText || ''; } });
                    processRulesSequentially(ruleIndex + 1);
                } else if (action.type === 'lookup_value') {
                    var config = action.lookupConfig;
                    if (!config || !config.sourceTableId || !config.matches || config.matches.length === 0 || !config.sourceValueColumn) {
                        console.error('Rule "' + group.name + '": Lookup configuration is incomplete.');
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }

                    var sourceTable = tables.find(function(t) { return t.id === config.sourceTableId; });
                    if (!sourceTable) {
                        console.error('Rule "' + group.name + '": Source table for lookup not found.');
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }
                    
                    processedData.forEach(function(row) {
                        if (checkRow(row, group.filters, mainTable)) {
                            var foundRow = sourceTable.data.find(function(sourceRow) {
                                let matchResult = false;
                                for (let i = 0; i < config.matches.length; i++) {
                                    var match = config.matches[i];
                                    var mainVal = row[match.mainColumn];
                                    var sourceVal = match.sourceType === 'column' ? sourceRow[match.sourceValue] : match.sourceValue;
                                    
                                    var currentConditionResult = false;
                                    
                                    if (mainVal !== null && mainVal !== undefined && sourceVal !== null && sourceVal !== undefined) {
                                        var mainStr = normalize(mainVal);
                                        var sourceStr = normalize(sourceVal);
                                        
                                        if (match.operator === 'equals') {
                                            currentConditionResult = mainStr === sourceStr;
                                        } else { // contains
                                            currentConditionResult = sourceStr.indexOf(mainStr) !== -1;
                                        }
                                    }

                                    if (i === 0) {
                                        matchResult = currentConditionResult;
                                    } else {
                                        var logic = match.logic || 'and';
                                        if (logic === 'and') {
                                            matchResult = matchResult && currentConditionResult;
                                        } else {
                                            matchResult = matchResult || currentConditionResult;
                                        }
                                    }
                                }
                                return matchResult;
                            });
                            
                            if (foundRow) {
                                row[action.newColumnName] = config.sourceValueType === 'column' ? foundRow[config.sourceValueColumn] : config.sourceValueColumn;
                            }
                        }
                    });
                    processRulesSequentially(ruleIndex + 1);
                } else if (action.type === 'count_duplicates') {
                    var config = action.countDuplicatesConfig;
                    if (!config || !config.sourceColumn) {
                        console.error('Rule "' + group.name + '": Count Duplicates configuration is incomplete.');
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }
                    var sourceColumn = config.sourceColumn;
                    var valueCounts = new Map();

                    // First pass: count all values in the source column across the entire dataset
                    processedData.forEach(function(row) {
                        var value = row[sourceColumn];
                        if (value !== null && value !== undefined) {
                            var normalizedValue = String(value).trim().toLowerCase();
                            valueCounts.set(normalizedValue, (valueCounts.get(normalizedValue) || 0) + 1);
                        }
                    });
                    
                    // Second pass: apply counts to rows matching the filter
                    processedData.forEach(function(row) {
                        if (checkRow(row, group.filters, mainTable)) {
                            var value = row[sourceColumn];
                            if (value !== null && value !== undefined) {
                                var normalizedValue = String(value).trim().toLowerCase();
                                row[action.newColumnName] = valueCounts.get(normalizedValue) || 0;
                            } else {
                                row[action.newColumnName] = 0;
                            }
                        }
                    });
                    processRulesSequentially(ruleIndex + 1);
                } else if (action.type === 'multi_match') {
                    var config = action.multiMatchConfig;
                    if (!config || !config.rules || config.rules.length === 0) {
                        console.error('Rule "' + group.name + '": Multi-match configuration is incomplete.');
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }

                    processedData.forEach(function(row) {
                        if (checkRow(row, group.filters, mainTable)) {
                            var valueToApply = undefined;

                            config.rules.forEach(function(subRule) {
                                if (checkRow(row, subRule.conditions, mainTable)) {
                                    valueToApply = row[subRule.sourceColumn];
                                }
                            });

                            if (valueToApply !== undefined) {
                                row[action.newColumnName] = valueToApply;
                            }
                        }
                    });
                    processRulesSequentially(ruleIndex + 1);
                } else if (action.type === 'inclusion_match') {
                    var config = action.inclusionMatchConfig;
                    if (!config || !config.sourceTableId || !config.mainSearchColumn || !config.sourceMatchColumn || !config.sourceValueColumn) {
                        console.error('Rule "' + group.name + '": Inclusion Match configuration is incomplete.');
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }

                    var sourceTable = tables.find(function(t) { return t.id === config.sourceTableId; });
                    if (!sourceTable) {
                        console.error('Rule "' + group.name + '": Source table for inclusion match not found.');
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }
                    
                    var sourceMatchData = sourceTable.data.map(function(row) {
                        return {
                            matchValue: row[config.sourceMatchColumn],
                            resultValue: row[config.sourceValueColumn]
                        };
                    }).filter(function(item) {
                        return item.matchValue !== null && item.matchValue !== undefined && String(item.matchValue).trim() !== '';
                    });

                    var matchDirection = config.matchDirection || 'main_contains_source';

                    processedData.forEach(function(row) {
                        if (checkRow(row, group.filters, mainTable)) {
                            var mainTableValue = row[config.mainSearchColumn];
                            if (mainTableValue !== null && mainTableValue !== undefined) {
                                var normalizedMainTableValue = normalize(mainTableValue);
                                
                                for (var i = 0; i < sourceMatchData.length; i++) {
                                    var sourceItem = sourceMatchData[i];
                                    var normalizedSourceMatchValue = normalize(sourceItem.matchValue);
                                    
                                    var isMatch = false;
                                    if (matchDirection === 'source_contains_main') {
                                        if (normalizedSourceMatchValue.indexOf(normalizedMainTableValue) !== -1) {
                                            isMatch = true;
                                        }
                                    } else { // 'main_contains_source'
                                        if (normalizedMainTableValue.indexOf(normalizedSourceMatchValue) !== -1) {
                                            isMatch = true;
                                        }
                                    }

                                    if (isMatch) {
                                        row[action.newColumnName] = sourceItem.resultValue;
                                        break; 
                                    }
                                }
                            }
                        }
                    });
                    processRulesSequentially(ruleIndex + 1);
                } else if (action.type === 'cross_column_calculation') {
                    var config = action.crossColumnCalculationConfig;
                    if (!config || !config.parts || config.parts.length < 2) {
                        console.error('Rule "' + group.name + '": Cross-column calculation configuration is incomplete.');
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }

                    processedData.forEach(function(row) {
                        if (checkRow(row, group.filters, mainTable)) {
                            try {
                                var expression = "";
                                config.parts.forEach(function(part, index) {
                                    if (index > 0 && part.operator) {
                                        expression += " " + part.operator + " ";
                                    }
                                    
                                    // Add open brackets
                                    for (var i = 0; i < (part.openBrackets || 0); i++) {
                                        expression += "(";
                                    }
                                    
                                    var val = parseFloat(String(row[part.columnName]));
                                    if (isNaN(val)) val = 0;
                                    expression += val;
                                    
                                    // Add close brackets
                                    for (var i = 0; i < (part.closeBrackets || 0); i++) {
                                        expression += ")";
                                    }
                                });

                                // Basic validation for safety: only allow numbers, operators, dots, and parentheses
                                var result = 0;
                                if (/^[0-9.+\\*\\/()\\s-]*$/.test(expression)) {
                                    try {
                                        // Using Function to evaluate mathematical expression
                                        // Wrapping in try-catch to handle malformed expressions (e.g., unbalanced parentheses)
                                        result = new Function('"use strict"; return (' + expression + ')')();
                                    } catch (e) {
                                        console.warn('Malformed expression:', expression);
                                        result = 0;
                                    }
                                }
                                
                                var numResult = isFinite(result) ? result : 0;
                                row[action.newColumnName] = parseFloat(numResult.toFixed(3));
                            } catch (err) {
                                console.error('Calculation error for rule "' + group.name + '":', err);
                                row[action.newColumnName] = 'CALC_ERROR';
                            }
                        }
                    });
                    processRulesSequentially(ruleIndex + 1);
                } else if (action.type === 'ai_formula') {
                    if (!ai) {
                        self.postMessage({ type: 'APPLY_RULES_PROGRESS', payload: { ...progressPayload, message: '跳过 AI 规则 (未提供 API Key): ' + group.name } });
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }

                    var matchingRows = [];
                    var matchingRowsIndices = [];
                    processedData.forEach(function(row, index) {
                        if (checkRow(row, group.filters, mainTable)) {
                            matchingRows.push(row);
                            matchingRowsIndices.push(index);
                        }
                    });

                    if (matchingRows.length === 0) {
                        processRulesSequentially(ruleIndex + 1);
                        return;
                    }

                    var prompt = 'For each JSON object in the following array, apply this instruction: "' + action.aiPrompt + '". Return a valid JSON array of strings or numbers with the results, one for each object. The output array must have the same number of elements as the input array. Only return the JSON array, with no other text or markdown.\\n\\n' + JSON.stringify(matchingRows);

                    ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                    })
                    .then(function(result) {
                        var text = result.text;
                        if (!text) {
                            throw new Error('AI returned an empty response.');
                        }
                        text = text.trim();
                        var jsonArray;
                        try {
                            var jsonString = text.replace(/^\\\`\\\`\\\`json\\s*|\\\`\\\`\\\`\\s*$/g, '');
                            jsonArray = JSON.parse(jsonString);
                            if (!Array.isArray(jsonArray) || jsonArray.length !== matchingRows.length) {
                                throw new Error('AI returned an array with ' + (jsonArray.length || 'unknown') + ' elements, expected ' + matchingRows.length + '.');
                            }
                        } catch (err) {
                            console.error("AI Response parsing error:", err, "Raw response:", text);
                            jsonArray = new Array(matchingRows.length).fill('AI_PARSE_ERROR: ' + err.message);
                        }

                        jsonArray.forEach(function(res, index) {
                            if (matchingRowsIndices[index] !== undefined) {
                                processedData[matchingRowsIndices[index]][action.newColumnName] = res;
                            }
                        });
                    })
                    .catch(function(err) {
                        console.error("Gemini API error:", err);
                        matchingRowsIndices.forEach(function(idx) {
                            processedData[idx][action.newColumnName] = 'API_ERROR';
                        });
                    })
                    .finally(function() {
                        processRulesSequentially(ruleIndex + 1);
                    });
                } else {
                    processRulesSequentially(ruleIndex + 1);
                }
            };
            processRulesSequentially(0);
        }
    } catch (err) {
        self.postMessage({ type: 'ERROR', error: err.message || 'Worker 发生未知错误' });
    }
};
`;

const migrateRuleGroup = (rule: any): RuleGroup => {
  // This is a simplified version that was likely present before robust error handling was added.
  // It only handles one specific legacy format.
  if (rule.filters && rule.filters.length > 0 && !('logic' in rule.filters[0]) && 'filterLogic' in rule) {
    const { filterLogic, ...restOfRule } = rule;
    const newFilters = restOfRule.filters.map((filter: FilterCondition, index: number) => {
      if (index === 0) {
        const { logic, ...restOfFilter } = filter as any;
        return restOfFilter;
      }
      return { ...filter, logic: filterLogic || 'and' };
    });
    return { ...restOfRule, filters: newFilters, isCollapsed: restOfRule.isCollapsed ?? true };
  }
  return { ...rule, isCollapsed: rule.isCollapsed ?? true } as RuleGroup;
};


const App: React.FC = () => {
  const [tables, setTables] = useState<Table[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('正在处理...');
  const [error, setError] = useState<string | null>(null);
  const [ruleGroups, setRuleGroups] = useState<RuleGroup[]>([]);
  const [ruleCategories, setRuleCategories] = useState<RuleCategory[]>([]);
  const [appName] = useState<string>('班夫里核算系统');
  const [activeView, setActiveView] = useState<'table' | 'rules' | 'fields' | 'customTables'>('table');

  // State for Custom Tables View
  const [activeCustomTableId, setActiveCustomTableId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ tableId: string; rowIndex: number; column: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const mainTable = useMemo(() => tables.length > 0 ? tables[0] : null, [tables]);

  const paginatedData = useMemo(() => {
    if (!mainTable) return [];
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return mainTable.data.slice(start, end);
  }, [mainTable, currentPage, pageSize]);

  const importRulesInputRef = useRef<HTMLInputElement>(null);
  const importTemplateInputRef = useRef<HTMLInputElement>(null);
  const [isImportExportOpen, setIsImportExportOpen] = useState(false);
  const importExportMenuRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    let workerUrl: string | null = null;
    try {
      const blob = new Blob([workerScript], { type: 'application/javascript' });
      workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      workerRef.current = worker;
    } catch (err) {
      console.error("Failed to initialize worker:", err);
      setError("无法初始化后台处理模块，应用可能无法正常工作。请检查浏览器是否支持 Web Worker。");
    }
    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerRef.current = null;
    };
  }, []);
  
  const handleWorkerMessage = useCallback((e: MessageEvent) => {
    const { type, payload, error: workerError } = e.data;
    switch (type) {
        case 'PARSE_SUCCESS': {
            const { data: parsedData, headers: parsedHeaders, fileName, tableId: updatedTableId } = payload;
            
            if (updatedTableId) {
                const isMainTable = mainTable?.id === updatedTableId;
                const newTableName = fileName.replace(/\.xlsx$/i, '');

                setTables(prevTables => prevTables.map(t => {
                    if (t.id === updatedTableId) {
                        const updatedTable = { 
                            ...t, 
                            data: parsedData, 
                            headers: parsedHeaders, 
                            originalData: parsedData 
                        };
                        // Only rename if it's NOT the main table
                        if (!isMainTable) {
                            updatedTable.name = newTableName;
                        }
                        return updatedTable;
                    }
                    return t;
                }));
                 
                if (isMainTable) {
                    setRuleGroups(currentRuleGroups => validateRuleGroups(currentRuleGroups, parsedHeaders));
                    setActiveView('table');
                } else {
                    setActiveView('customTables');
                }
            }
            setIsLoading(false);
            break;
        }
        case 'APPLY_RULES_PROGRESS':
            setLoadingMessage(`${payload.message} (${Math.round(payload.progress * 100)}%)`);
            break;
        case 'APPLY_RULES_SUCCESS':
            const processedData = payload.processedData;
            let finalHeaders = processedData.length > 0 ? Object.keys(processedData[0]) : tables[0].headers;
            setTables(prevTables => prevTables.map((t, index) => {
                if (index === 0) { // Always applies to main table
                    return { ...t, data: processedData, headers: finalHeaders };
                }
                return t;
            }));
            setRuleGroups(prevRules => validateRuleGroups(prevRules, finalHeaders));
            setActiveView('table');
            setIsLoading(false);
            break;
        case 'ERROR':
            setError(workerError);
            setIsLoading(false);
            break;
    }
  }, [tables, mainTable]);


  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (err) => {
      console.error("Worker error:", err);
      const message = `后台处理模块发生致命错误: ${err.message}. 这可能是由于网络问题无法加载所需脚本，或数据格式异常。请检查网络连接并刷新页面重试。`;
      setError(message);
      setIsLoading(false);
      err.preventDefault();
    };
  }, [handleWorkerMessage]);

  useEffect(() => {
    try {
      const savedDataJson = localStorage.getItem(DATA_STORAGE_KEY);
      if (savedDataJson) {
        const savedData = JSON.parse(savedDataJson);
        if (savedData.tables && savedData.rules && savedData.categories) {
           setTables(savedData.tables);
           if (savedData.tables.length > 0 && !activeCustomTableId) {
             setActiveCustomTableId(savedData.tables.find((t: Table, i: number) => i > 0)?.id || null);
           }
           const migratedRules = savedData.rules.map(migrateRuleGroup).filter((r: RuleGroup | null) => r !== null) as RuleGroup[];
           setRuleGroups(migratedRules.map(rule => ({ ...rule, enabled: false, validationError: null })));
           setRuleCategories(savedData.categories);
        } else { // Migration from old single-table format
            const mainTableId = crypto.randomUUID();
            const newTable: Table = {
                id: mainTableId,
                name: "主表",
                data: [],
                headers: [],
                originalData: []
            };
            setTables([newTable]);
        }
      } else {
         const mainTableId = crypto.randomUUID();
         const newTable: Table = { id: mainTableId, name: "主表", data: [], headers: [], originalData: [] };
         setTables([newTable]);
      }
    } catch (err) {
      console.error("Failed to load data from localStorage", err);
      setError(`加载本地工作区失败: ${err instanceof Error ? err.message : '未知错误'}.`);
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (importExportMenuRef.current && !importExportMenuRef.current.contains(event.target as Node)) {
        setIsImportExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveDataToLocalStorage = useCallback(() => {
    try {
      const rulesToSave = ruleGroups.map(({ enabled, validationError, ...rest }) => rest);
      // Only persist table metadata (id, name, headers) to avoid storage quota issues.
      // Data must be re-uploaded by the user on each visit.
      const tablesMetadata = tables.map(({ id, name, headers }) => ({
        id,
        name,
        headers,
        data: [], 
        originalData: [],
      }));
      
      const dataToSave = {
        tables: tablesMetadata,
        rules: rulesToSave,
        categories: ruleCategories,
      };
      localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (err) {
      console.error("Failed to save data to localStorage", err);
      if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          setError('保存工作区失败：浏览器存储空间已满。您上传的数据过大，请刷新页面并使用较小的数据文件。规则和配置已保存。');
      } else {
          setError(`保存工作区失败: ${err instanceof Error ? err.message : '未知错误'}.`);
      }
    }
  }, [tables, ruleGroups, ruleCategories]);

  useEffect(() => {
    saveDataToLocalStorage();
  }, [tables, ruleGroups, ruleCategories, saveDataToLocalStorage]);


  const handleRulesAndCategoriesChange = useCallback((newRuleGroups: RuleGroup[], newRuleCategories: RuleCategory[]) => {
    setRuleGroups(newRuleGroups);
    setRuleCategories(newRuleCategories);
  }, []);

  const handleExportRules = () => {
    setIsImportExportOpen(false);
    if (ruleGroups.length === 0) {
      setError("没有可导出的规则。");
      return;
    }
    try {
        const rulesToExport = ruleGroups.map(({ enabled, validationError, isCollapsed, ...rest }) => {
            const newRest = JSON.parse(JSON.stringify(rest)); // Deep copy to avoid mutating state
    
            const findAndSetTableName = (configObject: any, tableIdField: string) => {
                if (configObject && configObject[tableIdField]) {
                    const table = tables.find(t => t.id === configObject[tableIdField]);
                    if (table) {
                        configObject.tableName = table.name;
                    }
                }
            };
    
            const action = newRest.action as AllocationAction;
            if (action.type === 'distribute_amount' && action.sourceType === 'cell') {
                findAndSetTableName(action.cellSource, 'tableId');
            } else if (action.type === 'lookup_value') {
                findAndSetTableName(action.lookupConfig, 'sourceTableId');
            } else if (action.type === 'inclusion_match') {
                findAndSetTableName(action.inclusionMatchConfig, 'sourceTableId');
            }
    
            return { ...newRest, isCollapsed: isCollapsed ?? true };
        });
    
        const dataStr = JSON.stringify({ rules: rulesToExport, categories: ruleCategories }, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "banbury_rules.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (err) {
        setError(`导出规则失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleExportRulesAsXlsx = () => {
    setIsImportExportOpen(false);
    if (ruleGroups.length === 0) {
      setError("没有可导出的规则。");
      return;
    }
    try {
      const operatorMapReverse: Record<FilterCondition['operator'], string> = { contains: '包含', not_contains: '不包含', equals: '等于', not_equals: '不等于', is_empty: '为空', is_not_empty: '不为空' };
      const actionMapReverse: Record<string, string> = { distribute_amount: '平摊金额', fill_text: '填充文本', ai_formula: 'AI 公式', lookup_value: '查询匹配', count_duplicates: '列重复统计', multi_match: '多维匹配', inclusion_match: '包含匹配', cross_column_calculation: '跨列计算' };

      const xlsxHeaders = ["分类名称", "规则组名称", "筛选列", "筛选操作", "筛选值", "与上一条的逻辑", "操作类型", "目标列", "操作值", "金额来源类型", "金额来源表", "金额来源列", "金额来源筛选条件"];
      const rows: (string|number)[][] = [xlsxHeaders];

      const groupToCategoryMap: Record<string, string> = {};
      ruleCategories.forEach(category => {
        category.ruleGroupIds.forEach(groupId => {
            groupToCategoryMap[groupId] = category.name;
        });
      });

      ruleGroups.forEach(group => {
        const categoryName = groupToCategoryMap[group.id] || '';
        const action = group.action;

        const populateActionData = (isFirstFilterLine: boolean) => {
            if (!isFirstFilterLine) return ['', '', '', '', '', '', ''];

            const baseActionData = [
                actionMapReverse[action.type] || action.type,
                action.newColumnName,
            ];

            if (action.type === 'distribute_amount') {
                if (action.sourceType === 'cell' && action.cellSource) {
                    const sourceTable = tables.find(t => t.id === action.cellSource.tableId);
                    const filtersString = action.cellSource.filters.map((f, i) => {
                        const logicPrefix = i > 0 ? (f.logic === 'or' ? '或者' : '并且') + ';' : '';
                        return `${logicPrefix}${f.column}:${operatorMapReverse[f.operator] || f.operator}:${f.value}`;
                    }).join('');
                    return [
                        ...baseActionData,
                        '', // 操作值 is empty for cell source
                        '来自单元格',
                        sourceTable ? sourceTable.name : '未找到表',
                        action.cellSource.column,
                        filtersString
                    ];
                }
                // Manual or legacy
                return [...baseActionData, action.totalAmount || '', '手动输入', '', '', ''];
            }
            if (action.type === 'fill_text') {
                return [...baseActionData, action.fillText || '', '', '', '', ''];
            }
            if (action.type === 'ai_formula') {
                return [...baseActionData, action.aiPrompt || '', '', '', '', ''];
            }
            if (action.type === 'lookup_value' && action.lookupConfig) {
                 const sourceTable = tables.find(t => t.id === action.lookupConfig.sourceTableId);
                 const opValue = `从[${sourceTable?.name || '未知表'}]查找; 主表列:[${action.lookupConfig.mainMatchColumn}]; 源表列:[${action.lookupConfig.sourceMatchColumn}]; 取值列:[${action.lookupConfig.sourceValueColumn}]`;
                 return [...baseActionData, opValue, '', '', '', ''];
            }
            if (action.type === 'count_duplicates' && action.countDuplicatesConfig) {
                 return [...baseActionData, action.countDuplicatesConfig.sourceColumn, '', '', '', ''];
            }
             if (action.type === 'multi_match' && action.multiMatchConfig) {
                const opValue = action.multiMatchConfig.rules.map(rule => {
                    const conditions = rule.conditions.map((c, i) => {
                        const opStr = operatorMapReverse[c.operator] || c.operator;
                        const valStr = ['is_empty', 'is_not_empty'].includes(c.operator) ? '' : c.value;
                        const logicPrefix = i > 0 ? (c.logic === 'or' ? ' 或者 ' : ' 并且 ') : '';
                        return `${logicPrefix}${c.column} ${opStr} ${valStr}`.trim();
                    }).join('');
                    return `如果 {${conditions}} 则取值 [${rule.sourceColumn}]`;
                }).join('; ');

                 return [...baseActionData, opValue, '', '', '', ''];
            }
            if (action.type === 'inclusion_match' && action.inclusionMatchConfig) {
                 const config = action.inclusionMatchConfig;
                 const sourceTable = tables.find(t => t.id === config.sourceTableId);
                 const directionText = config.matchDirection === 'source_contains_main' ? '源表列包含主表列' : '主表列包含源表列';
                 const opValue = `从[${sourceTable?.name || '未知表'}]查找; 主表匹配列:[${config.mainSearchColumn}]; 源表匹配列:[${config.sourceMatchColumn}]; 取值列:[${config.sourceValueColumn}]; 逻辑:[${directionText}]`;
                 return [...baseActionData, opValue, '', '', '', ''];
            }
            if (action.type === 'cross_column_calculation' && action.crossColumnCalculationConfig) {
                const formulaString = action.crossColumnCalculationConfig.parts.map((part, index) => {
                    const col = `[${part.columnName}]`;
                    return index === 0 ? col : ` ${part.operator} ${col}`;
                }).join('');
                return [...baseActionData, formulaString, '', '', '', ''];
            }
            return [...baseActionData, '', '', '', '', ''];
        };

        if (group.filters.length === 0) {
            rows.push([
                categoryName,
                group.name, '', '', '', '',
                ...populateActionData(true)
            ]);
        } else {
            group.filters.forEach((filter, index) => {
                const row: (string|number)[] = [];
                if (index === 0) {
                    row.push(
                        categoryName,
                        group.name,
                        filter.column,
                        operatorMapReverse[filter.operator] || filter.operator,
                        filter.value,
                        '', // First filter has no logic
                        ...populateActionData(true)
                    );
                } else {
                    row.push(
                        '', '',
                        filter.column,
                        operatorMapReverse[filter.operator] || filter.operator,
                        filter.value,
                        filter.logic === 'or' ? '或者' : '并且',
                        ...populateActionData(false)
                    );
                }
                rows.push(row);
            });
        }
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '规则');
      XLSX.writeFile(wb, 'banbury_rules_exported.xlsx');
    } catch (err) {
       setError(`导出规则为 XLSX 失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleImportRules = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsImportExportOpen(false);
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json') {
      setError("导入失败：请选择一个有效的 .json 文件。");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') throw new Error("文件内容无法读取为文本。");
        const importedData = JSON.parse(text);

        let importedRules;
        let importedCategories = [];

        if (Array.isArray(importedData)) { // Old format
            importedRules = importedData;
        } else if (importedData.rules && importedData.categories) { // New format
            importedRules = importedData.rules;
            importedCategories = importedData.categories;
        } else {
            throw new Error("文件格式不正确或缺少必要的规则属性。");
        }

        if (!Array.isArray(importedRules) || importedRules.some(r => !r.id || !r.name || !r.filters || !r.action)) {
          throw new Error("文件格式不正确或缺少必要的规则属性。");
        }
        
        const migratedRules = importedRules.map(migrateRuleGroup).filter(r => r !== null) as RuleGroup[];
        
        // Post-process rules to match table IDs by name for portability
        const remappedRules = migratedRules.map(rule => {
            const newRule = JSON.parse(JSON.stringify(rule)); // Deep copy
    
            const remapTableId = (configObject: any, tempTableNameField: string, tableIdField: string) => {
                if (configObject && configObject[tempTableNameField]) {
                    const targetTableName = configObject[tempTableNameField].trim();
                    const matchingTable = tables.find(t => t.name.trim() === targetTableName);
                    configObject[tableIdField] = matchingTable ? matchingTable.id : '';
                    delete configObject[tempTableNameField]; // Clean up
                }
            };
    
            const action = newRule.action as AllocationAction;
            if (action.type === 'distribute_amount' && action.sourceType === 'cell') {
                remapTableId(action.cellSource, 'tableName', 'tableId');
            } else if (action.type === 'lookup_value') {
                remapTableId(action.lookupConfig, 'tableName', 'sourceTableId');
            } else if (action.type === 'inclusion_match') {
                remapTableId(action.inclusionMatchConfig, 'tableName', 'sourceTableId');
            }
            
            return newRule;
        });

        const newRuleGroups = remappedRules.map((rule: RuleGroup) => ({
           ...rule,
           enabled: false,
           validationError: null,
        }));
        
        handleRulesAndCategoriesChange(newRuleGroups, importedCategories);
        
        if (mainTable) {
            setRuleGroups(validateRuleGroups(newRuleGroups, mainTable.headers));
        }

        setError(null);
      } catch (err) {
        setError(`导入规则失败: ${err instanceof Error ? err.message : '未知错误'}`);
      } finally {
        if(event.target) event.target.value = '';
      }
    };
    reader.onerror = () => setError("读取规则文件失败。");
    reader.readAsText(file);
  };

   const handleDownloadRuleTemplate = () => {
    setIsImportExportOpen(false);
    const xlsxHeaders = [
      "分类名称", "规则组名称", "筛选列", "筛选操作 (包含/不包含/等于/不等于/为空/不为空)",
      "筛选值", "与上一条的逻辑 (并且/或者)", "操作类型 (平摊金额/填充文本/AI 公式/查询匹配/列重复统计/多维匹配/包含匹配/跨列计算)",
      "目标列", "操作值 (金额/文本/AI指令/查询配置/统计列/多维配置/计算公式)", "金额来源类型 (手动输入/来自单元格)", "金额来源表",
      "金额来源列", "金额来源筛选条件 (格式: 列:操作:值;逻辑;列2:操作2:值2)"
    ];
    const exampleData = [
      ["店铺奖励", "月度优秀店铺奖励", "店铺等级", "等于", "S", "", "填充文本", "奖励状态", "已奖励", "", "", "", ""],
      ["", "月度优秀店铺奖励", "月销售额", "大于", "50000", "并且", "", "", "", "", "", "", ""],
      ["财务分摊", "分摊报销费用", "费用类型", "等于", "差旅费", "", "平摊金额", "差旅费分摊", "", "来自单元格", "财务表", "总金额", "单据号:等于:BX001"],
      ["", "计算利润", "订单状态", "等于", "已完成", "", "跨列计算", "利润", "[销售额] - [成本] - [平台费]", "", "", "", ""],
    ];
    const templateData = [xlsxHeaders, ...exampleData];
    try {
      const ws = XLSX.utils.aoa_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '规则模板');
      XLSX.writeFile(wb, 'banbury_rules_template.xlsx');
    } catch (err) {
      setError(`下载模板失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleImportRulesFromTemplate = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsImportExportOpen(false);
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const fileData = e.target?.result;
        const workbook = XLSX.read(fileData, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) throw new Error("模板文件为空。");

        const operatorMap: Record<string, FilterCondition['operator']> = { '包含': 'contains', '不包含': 'not_contains', '等于': 'equals', '不等于': 'not_equals', '为空': 'is_empty', '不为空': 'is_not_empty' };
        const actionMap: Record<string, RuleGroup['action']['type']> = { '平摊金额': 'distribute_amount', '填充文本': 'fill_text', 'AI 公式': 'ai_formula', '查询匹配': 'lookup_value', '列重复统计': 'count_duplicates', '多维匹配': 'multi_match', '包含匹配': 'inclusion_match', '跨列计算': 'cross_column_calculation' };
        const operatorMapReverse: Record<FilterCondition['operator'], string> = { contains: '包含', not_contains: '不包含', equals: '等于', not_equals: '不等于', is_empty: '为空', is_not_empty: '不为空' };


        const groupedRules: { [key: string]: RuleGroup } = {};
        const categoriesMap: { [key: string]: RuleCategory } = {};
        
        let lastGroupName: string | null = null;
        
        const getVal = (row: any, ...keys: string[]) => {
            for (const key of keys) {
                if (row[key] !== undefined) return row[key];
            }
            return undefined;
        };

        jsonData.forEach(row => {
          let groupName = getVal(row, '规则组名称');
          if (!groupName && lastGroupName) {
              groupName = lastGroupName;
          } else if (groupName) {
              lastGroupName = groupName;
          }

          if (!groupName) {
              return; 
          }

          if (getVal(row, '规则组名称') && !groupedRules[groupName]) {
            const actionTypeStr = getVal(row, '操作类型 (平摊金额/填充文本/AI 公式/查询匹配/列重复统计/多维匹配/包含匹配/跨列计算)', '操作类型');
            const actionType = actionMap[actionTypeStr as string];
            if (!actionType) return;

            const opValue = getVal(row, '操作值 (金额/文本/AI指令/查询配置/统计列/多维配置/计算公式)', '操作值');
            const newAction: RuleGroup['action'] = {
                type: actionType,
                newColumnName: getVal(row, '目标列') || '',
            };

            if (actionType === 'distribute_amount') {
                const sourceType = getVal(row, '金额来源类型 (手动输入/来自单元格)', '金额来源类型') || '手动输入';
                if (sourceType === '来自单元格') {
                    const sourceTableName = (getVal(row, '金额来源表') || '').trim();
                    let sourceTable = null;
                    if(sourceTableName) {
                        sourceTable = tables.find(t => t.name.trim() === sourceTableName);
                    }
                    const filterStr: string = getVal(row, '金额来源筛选条件 (格式: 列:操作:值;逻辑;列2:操作2:值2)', '金额来源筛选条件') || '';
                    
                    const cellSourceFilters: FilterCondition[] = [];
                    if (filterStr) {
                      const filterParts = filterStr.split(';');
                      filterParts.forEach((part, i) => {
                          let currentPart = part.trim();
                          let logic: 'and' | 'or' = 'and';
                          if (i > 0) {
                            if (currentPart.startsWith('或者')) {
                                logic = 'or';
                                currentPart = currentPart.substring(2).trim();
                            } else if (currentPart.startsWith('并且')) {
                                logic = 'and';
                                currentPart = currentPart.substring(2).trim();
                            }
                          }
                          const details = currentPart.split(':');
                          if (details.length >= 2) {
                              const [column, opStr, ...valParts] = details;
                              const value = valParts.join(':');
                              const operatorKey = Object.keys(operatorMap).find(key => key === opStr.trim()) as string;
                              const operator = operatorMap[operatorKey] || 'contains';
                              const newFilter: FilterCondition = { id: crypto.randomUUID(), column: column.trim(), operator, value };
                              if (i > 0) newFilter.logic = logic;
                              cellSourceFilters.push(newFilter);
                          }
                      });
                    }

                    newAction.sourceType = 'cell';
                    newAction.cellSource = {
                        tableId: sourceTable ? sourceTable.id : '',
                        column: getVal(row, '金额来源列') || '',
                        filters: cellSourceFilters
                    };
                } else {
                    newAction.sourceType = 'manual';
                    newAction.totalAmount = opValue !== undefined ? parseFloat(opValue) : undefined;
                }
            } else if (actionType === 'fill_text') {
                newAction.fillText = opValue !== undefined ? String(opValue) : undefined;
            } else if (actionType === 'ai_formula') {
                newAction.aiPrompt = opValue !== undefined ? String(opValue) : undefined;
            } else if (actionType === 'count_duplicates') {
                newAction.countDuplicatesConfig = {
                    sourceColumn: opValue !== undefined ? String(opValue) : '',
                };
            } else if (actionType === 'lookup_value') {
                const regex = /从\[(.*?)]查找; 主表列:\[(.*?)]; 源表列:\[(.*?)]; 取值列:\[(.*?)]/;
                const match = String(opValue).match(regex);
                if (match) {
                    const sourceTableName = match[1].trim();
                    const sourceTable = tables.find(t => t.name.trim() === sourceTableName);
                    newAction.lookupConfig = {
                        sourceTableId: sourceTable ? sourceTable.id : '',
                        mainMatchColumn: match[2].trim(),
                        sourceMatchColumn: match[3].trim(),
                        sourceValueColumn: match[4].trim(),
                    };
                }
            } else if (actionType === 'inclusion_match') {
                const regex = /从\[(.*?)\]查找; 主表匹配列:\[(.*?)\]; 源表匹配列:\[(.*?)\]; 取值列:\[(.*?)\]; 逻辑:\[(.*?)\]/;
                const match = String(opValue).match(regex);
                if (match) {
                    const sourceTableName = match[1].trim();
                    const sourceTable = tables.find(t => t.name.trim() === sourceTableName);
                    const directionText = match[5].trim();
                    newAction.inclusionMatchConfig = {
                        sourceTableId: sourceTable ? sourceTable.id : '',
                        mainSearchColumn: match[2].trim(),
                        sourceMatchColumn: match[3].trim(),
                        sourceValueColumn: match[4].trim(),
                        matchDirection: directionText === '源表列包含主表列' ? 'source_contains_main' : 'main_contains_source',
                    };
                }
            } else if (actionType === 'multi_match') {
                const rules: MultiMatchRule[] = [];
                const ruleStrings = String(opValue).split(';').map((s: string) => s.trim()).filter(Boolean);
                const ruleRegex = /如果 {(.*?)} 则取值 \[(.*?)\]/;
            
                ruleStrings.forEach((ruleStr: string) => {
                    const match = ruleStr.match(ruleRegex);
                    if (match) {
                        const conditionsStr = match[1].trim();
                        const sourceColumn = match[2].trim();
            
                        const parseConditions = (str: string): FilterCondition[] => {
                            const result: FilterCondition[] = [];
                            const tokens = str.split(/\s+(并且|或者)\s+/);
                            let logic: 'and' | 'or' = 'and';
                            let isFirst = true;
            
                            while (tokens.length > 0) {
                                const condStr = tokens.shift()!.trim();
                                const reversedOps = Object.entries(operatorMapReverse).sort((a,b) => b[1].length - a[1].length);
                                let found = false;
                                for (const [key, label] of reversedOps) {
                                    if (condStr.endsWith(` ${label}`)) {
                                        const col = condStr.substring(0, condStr.length - label.length - 1).trim();
                                        const newCond: FilterCondition = { id: crypto.randomUUID(), column: col, operator: key as FilterCondition['operator'], value: ''};
                                        if (!isFirst) newCond.logic = logic;
                                        result.push(newCond);
                                        found = true;
                                        break;
                                    }
                                    const opIndex = condStr.indexOf(` ${label} `);
                                    if (opIndex > -1) {
                                        const col = condStr.substring(0, opIndex).trim();
                                        const val = condStr.substring(opIndex + label.length + 2).trim();
                                        const newCond: FilterCondition = { id: crypto.randomUUID(), column: col, operator: key as FilterCondition['operator'], value: val};
                                        if (!isFirst) newCond.logic = logic;
                                        result.push(newCond);
                                        found = true;
                                        break;
                                    }
                                }
                                if (!found) console.error("Could not parse condition:", condStr);
                                if (tokens.length > 0) {
                                    const logicStr = tokens.shift();
                                    logic = logicStr === '或者' ? 'or' : 'and';
                                }
                                isFirst = false;
                            }
                            return result;
                        };
            
                        rules.push({
                            id: crypto.randomUUID(),
                            conditions: parseConditions(conditionsStr),
                            sourceColumn: sourceColumn,
                        });
                    }
                });
            
                if (rules.length > 0) {
                    newAction.multiMatchConfig = { rules };
                }
            } else if (actionType === 'cross_column_calculation') {
                const formulaString = opValue ? String(opValue) : '';
                const regex = /(\s*[-+*\/]\s*)?\[(.*?)\]/g;
                let match;
                const parts = [];
                while ((match = regex.exec(formulaString)) !== null) {
                    const operatorWithSpaces = match[1];
                    const operator = operatorWithSpaces ? operatorWithSpaces.trim() : undefined;
                    const columnName = match[2].trim();
                    parts.push({
                        id: crypto.randomUUID(),
                        columnName: columnName,
                        operator: operator
                    });
                }
                if (parts.length > 0) {
                  delete parts[0].operator;
                }
                newAction.crossColumnCalculationConfig = { parts: parts };
            }

            groupedRules[groupName] = {
              id: crypto.randomUUID(), name: groupName, filters: [],
              action: newAction,
              enabled: false, isCollapsed: true, validationError: null
            };
          }
          
          const currentGroup = groupedRules[groupName];
          if (!currentGroup) return;

          const categoryName = getVal(row, '分类名称');
          if (categoryName) {
            let category = categoriesMap[categoryName];
            if (!category) {
              category = { id: crypto.randomUUID(), name: categoryName, isCollapsed: true, ruleGroupIds: [] };
              categoriesMap[categoryName] = category;
            }
            if (!category.ruleGroupIds.includes(currentGroup.id)) {
                category.ruleGroupIds.push(currentGroup.id);
            }
          }

          const filterColumn = getVal(row, '筛选列');
          if (filterColumn) {
            const operatorStr = getVal(row, '筛选操作 (包含/不包含/等于/不等于/为空/不为空)', '筛选操作');
            const logicStr = getVal(row, '与上一条的逻辑 (并且/或者)', '与上一条的逻辑');

            currentGroup.filters.push({
              id: crypto.randomUUID(),
              column: filterColumn,
              operator: operatorMap[operatorStr as string] || 'contains',
              value: String(getVal(row, '筛选值') || ''),
              logic: logicStr === '或者' ? 'or' : 'and',
            });
          }
        });
        
        Object.values(groupedRules).forEach(group => {
            if (group.filters.length > 0 && 'logic' in group.filters[0]) {
              delete group.filters[0].logic;
            }
        });

        const newImportedRuleGroups = Object.values(groupedRules);
        const newImportedCategoriesList = Object.values(categoriesMap);

        const finalRuleGroups = [...ruleGroups, ...newImportedRuleGroups];
        const finalCategories = [...ruleCategories];

        newImportedCategoriesList.forEach(importedCat => {
            const existingCat = finalCategories.find(c => c.name === importedCat.name);
            if (existingCat) {
                const combinedIds = new Set([...existingCat.ruleGroupIds, ...importedCat.ruleGroupIds]);
                existingCat.ruleGroupIds = Array.from(combinedIds);
            } else {
                finalCategories.push(importedCat);
            }
        });

        handleRulesAndCategoriesChange(finalRuleGroups, finalCategories);
        if (mainTable) {
            setRuleGroups(validateRuleGroups(finalRuleGroups, mainTable.headers));
        }
      } catch (err) {
        setError(`从模板导入规则失败: ${err instanceof Error ? err.message : '未知错误'}`);
      } finally {
        if (event.target) event.target.value = '';
      }
    };
    reader.onerror = () => setError("读取模板文件失败。");
    reader.readAsBinaryString(file);
  };

  const validateRuleGroups = (rules: RuleGroup[], currentHeaders: string[]): RuleGroup[] => {
      const columns = new Set(currentHeaders);
      
      // Sweep multiple times to resolve out-of-order dependencies, up to a reasonable limit
      let maxIterations = rules.length + 1;
      let iteration = 0;
      let rulesState = [...rules];
      
      while (iteration < maxIterations) {
          let anyChanged = false;
          let currentIterationValidIds = new Set<string>();
          
          for (let i = 0; i < rulesState.length; i++) {
              const group = rulesState[i];
              let validationError: string | null = null;
              
              for (const filter of group.filters) {
                  if (filter.column && !columns.has(filter.column)) {
                      validationError = `列 "${filter.column}" 在主表中不存在。`;
                      break;
                  }
              }
              
              // We also need to check source columns depending on the action type
              if (!validationError && group.action.type === 'cross_column_calculation') {
                  const config = group.action.crossColumnCalculationConfig;
                  if (config && config.parts) {
                      for (const part of config.parts) {
                          if (part.columnName && !columns.has(part.columnName)) {
                              validationError = `列 "${part.columnName}" 在跨列计算中不存在。`;
                              break;
                          }
                      }
                  }
              }
              if (!validationError && group.action.type === 'count_duplicates') {
                  if (group.action.countDuplicatesConfig?.sourceColumn && !columns.has(group.action.countDuplicatesConfig.sourceColumn)) {
                      validationError = `列 "${group.action.countDuplicatesConfig.sourceColumn}" 在重复列统计中不存在。`;
                  }
              }
              if (!validationError && group.action.type === 'multi_match') {
                  if (group.action.multiMatchConfig?.rules) {
                      for (const rule of group.action.multiMatchConfig.rules) {
                          for (const cond of rule.conditions) {
                              if (cond.column && !columns.has(cond.column)) {
                                  validationError = `列 "${cond.column}" 在多维匹配条件中不存在。`;
                                  break;
                              }
                          }
                          if (validationError) break;
                          if (rule.sourceColumn && !columns.has(rule.sourceColumn)) {
                              validationError = `列 "${rule.sourceColumn}" 在多维匹配取值列中不存在。`;
                              break;
                          }
                      }
                  }
              }
              if (!validationError && group.action.type === 'lookup_value') {
                  if (group.action.lookupConfig?.matches) {
                      for (const match of group.action.lookupConfig.matches) {
                          if (match.mainColumn && !columns.has(match.mainColumn)) {
                              validationError = `列 "${match.mainColumn}" 在查询匹配条件中不存在。`;
                              break;
                          }
                      }
                  }
              }
              if (!validationError && group.action.type === 'inclusion_match') {
                  if (group.action.inclusionMatchConfig?.mainSearchColumn && !columns.has(group.action.inclusionMatchConfig.mainSearchColumn)) {
                      validationError = `列 "${group.action.inclusionMatchConfig.mainSearchColumn}" 在包含匹配条件中不存在。`;
                  }
              }

              if (!validationError) {
                  currentIterationValidIds.add(group.id);
                  if (group.action.newColumnName && !columns.has(group.action.newColumnName)) {
                      columns.add(group.action.newColumnName);
                      anyChanged = true;
                  }
              }
              
              rulesState[i] = { ...group, validationError, enabled: !validationError ? true : false, isCollapsed: group.isCollapsed ?? true };
          }
          
          if (!anyChanged) break;
          iteration++;
      }
      
      return rulesState;
  };

  const handleFileUpload = useCallback((file: File, tableId: string) => {
    setIsLoading(true);
    setLoadingMessage('正在解析文件...');
    setError(null);
    setCurrentPage(1);
    
    setTables(prev => prev.map(t => t.id === tableId ? {...t, data: [], originalData: [], headers: []} : t));

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('上传失败：请选择一个有效的 .xlsx 文件。');
      setIsLoading(false);
      return;
    }
    workerRef.current?.postMessage({ type: 'PARSE_FILE', payload: { file, fileName: file.name, tableId } });
  }, []);

  const handleFileDownload = useCallback((table: Table) => {
    if (table.data.length === 0) { setError('没有数据可供下载。'); return; }
    try {
        if (table.data.length > 50000) {
            const BOM = '\uFEFF';
            const chunks: string[] = [BOM, table.headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',') + '\n'];
            
            let currentChunk = '';
            table.data.forEach((row, index) => {
                const rowData = table.headers.map(header => {
                    let cellData = row[header];
                    if (cellData === null || cellData === undefined) return '';
                    
                    if (typeof cellData === 'string' && cellData.trim() !== '') {
                        const trimmed = cellData.trim();
                        if (!/^0\d+/.test(trimmed) && trimmed.length < 15) {
                            const numParsed = Number(trimmed);
                            if (!isNaN(numParsed) && String(numParsed) !== "Infinity" && String(numParsed) !== "-Infinity") {
                                cellData = numParsed;
                            }
                        }
                    }
                    
                    let cellStr = String(cellData);
                    if (/[,"\n\r]/.test(cellStr)) {
                        cellStr = `"${cellStr.replace(/"/g, '""')}"`;
                    }
                    return cellStr;
                });
                currentChunk += rowData.join(',') + '\n';
                
                // Push in batches to prevent huge string accumulation
                if (index % 10000 === 0) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                }
            });
            if (currentChunk) chunks.push(currentChunk);

            const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${table.name}_processed.csv`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } else {
            const dataInOrder = table.data.map(row => {
              const orderedRow: TableRow = {};
              table.headers.forEach(header => {
                let val = row[header];
                if (typeof val === 'string' && val.trim() !== '') {
                    const trimmed = val.trim();
                    // Don't convert strings that look like IDs (start with 0, or very long numbers)
                    // But convert standard numbers, negatives, floats.
                    if (!/^0\d+/.test(trimmed) && trimmed.length < 15) {
                        const numParsed = Number(trimmed);
                        if (!isNaN(numParsed) && String(numParsed) !== "Infinity" && String(numParsed) !== "-Infinity") {
                            val = numParsed;
                        }
                    }
                }
                orderedRow[header] = val;
              });
              return orderedRow;
            });
            const worksheet = XLSX.utils.json_to_sheet(dataInOrder, { header: table.headers });
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
            XLSX.writeFile(workbook, `${table.name}_processed.xlsx`);
        }
    } catch (err) {
        setError(`创建文件时出错: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  }, []);

  const handleResetData = useCallback((tableId: string) => {
    setTables(prev => prev.map(t => {
      if (t.id === tableId) {
        return { ...t, data: t.originalData, headers: t.originalData.length > 0 ? Object.keys(t.originalData[0]) : [] };
      }
      return t;
    }));
    setCurrentPage(1);
    setError(null);
  }, []);

  const handleApplyAllocation = useCallback(() => {
    if (!mainTable || mainTable.originalData.length === 0) return;
    const activeRuleGroups = ruleGroups.filter(g => g.enabled && !g.validationError);
    if (activeRuleGroups.length === 0) { 
        setError("没有已启用的有效规则组可供应用。"); 
        return; 
    }
    
    for (const group of activeRuleGroups) {
        if (!group.action.newColumnName) {
            setError(`规则组 "${group.name || '未命名'}" 未填写目标列。`);
            return;
        }
    }
    
    setIsLoading(true);
    setLoadingMessage('正在应用规则...');
    setError(null);
    setCurrentPage(1);

    workerRef.current?.postMessage({
        type: 'APPLY_RULES',
        payload: { tables, activeRuleGroups, apiKey: process.env.API_KEY }
    });
  }, [tables, ruleGroups, mainTable]);
  
  const handleTablesUpdate = useCallback((newTables: Table[]) => {
    setTables(newTables);
  }, []);

  const handleTableUpdate = (updates: { headers?: string[]; data?: TableData; originalData?: TableData }, tableId: string) => {
      setTables(prev => prev.map(t => {
        if (t.id === tableId) {
            const newT = {...t};
            if(updates.headers) newT.headers = updates.headers;
            if(updates.data) newT.data = updates.data;
            if(updates.originalData) newT.originalData = updates.originalData;
            return newT;
        }
        return t;
      }));
  }

  const TabButton = ({ isActive, onClick, icon: Icon, label }: { isActive: boolean; onClick: () => void; icon: React.ElementType; label: string; }) => (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${ isActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700/50' }`} >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  );

  const renderCustomTablesView = () => {
    const customTables = tables.filter((_, index) => index > 0);
    const activeTable = tables.find(t => t.id === activeCustomTableId);

    const handleAddTable = () => {
        const name = `自定义表${customTables.length + 1}`;
        const newTable: Table = { id: crypto.randomUUID(), name, data: [], headers: [], originalData: [] };
        setTables([...tables, newTable]);
        setActiveCustomTableId(newTable.id);
    };

    const handleRenameTable = (tableId: string, newName: string) => {
        setTables(tables.map(t => t.id === tableId ? { ...t, name: newName } : t));
    };

    const handleDeleteTable = (tableId: string) => {
        const newTables = tables.filter(t => t.id !== tableId);
        setTables(newTables);
        if (activeCustomTableId === tableId) {
            setActiveCustomTableId(newTables.find((t, i) => i > 0)?.id || null);
        }
    };
    
    const handleAddRow = (tableId: string) => {
        const table = tables.find(t => t.id === tableId);
        if (!table) return;
        const newRow = table.headers.reduce((acc, h) => ({ ...acc, [h]: null }), {});
        const newData = [...table.data, newRow];
        handleTableUpdate({ data: newData, originalData: newData }, tableId);
    };

    const handleCopyRow = (tableId: string, rowIndex: number) => {
        const table = tables.find(t => t.id === tableId);
        if (!table || !table.data[rowIndex]) return;
        const rowToCopy = { ...table.data[rowIndex] };
        const newData = [...table.data];
        newData.splice(rowIndex + 1, 0, rowToCopy);
        handleTableUpdate({ data: newData, originalData: newData }, tableId);
    };

    const handleDeleteRow = (tableId: string, rowIndex: number) => {
        const table = tables.find(t => t.id === tableId);
        if (!table) return;
        const newData = table.data.filter((_, i) => i !== rowIndex);
        handleTableUpdate({ data: newData, originalData: newData }, tableId);
    };
    
    const startEditing = (tableId: string, rowIndex: number, column: string) => {
        const table = tables.find(t => t.id === tableId);
        if (!table) return;
        setEditingCell({ tableId, rowIndex, column });
        setEditingValue(String(table.data[rowIndex][column] ?? ''));
    };

    const handleSaveEdit = () => {
        if (!editingCell) return;
        const { tableId, rowIndex, column } = editingCell;
        const table = tables.find(t => t.id === tableId);
        if (!table) return;
        const newData = [...table.data];
        newData[rowIndex] = { ...newData[rowIndex], [column]: editingValue };
        handleTableUpdate({ data: newData, originalData: newData }, tableId);
        setEditingCell(null);
    };

    return (
        <div className="flex-grow flex flex-col h-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">自定义表格管理</h3>
                <button onClick={handleAddTable} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
                    <PlusCircleIcon className="h-4 w-4" />
                    <span>新增表格</span>
                </button>
            </div>
            <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
                <nav className="flex space-x-2 p-2" aria-label="Tables">
                    {customTables.map(table => (
                        <button key={table.id} onClick={() => setActiveCustomTableId(table.id)} className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-2 ${activeCustomTableId === table.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}>
                            {table.name}
                        </button>
                    ))}
                    {customTables.length === 0 && <p className="p-2 text-sm text-gray-500">尚未创建自定义表格。</p>}
                </nav>
            </div>
            {activeTable && (
                <div className="flex-grow flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4">
                        <input type="text" value={activeTable.name} onChange={e => handleRenameTable(activeTable.id, e.target.value)} className="text-lg font-semibold bg-transparent border-0 border-b-2 border-transparent focus:border-blue-500 focus:ring-0" />
                        <div className="flex items-center gap-2 ml-auto">
                            <FileUpload onFileUpload={(file) => handleFileUpload(file, activeTable.id)} disabled={isLoading} />
                            <DownloadButton onDownload={() => handleFileDownload(activeTable)} disabled={activeTable.data.length === 0 || isLoading} />
                            <ResetButton onReset={() => handleResetData(activeTable.id)} disabled={activeTable.originalData.length === 0} />
                             <button onClick={() => handleDeleteTable(activeTable.id)} className="p-2 rounded-full text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50"><Trash className="h-5 w-5" /></button>
                        </div>
                    </div>
                    <div className="flex-grow overflow-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
                                <tr>
                                    {activeTable.headers.map(h => <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{h}</th>)}
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">操作</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {activeTable.data.map((row, rowIndex) => (
                                    <tr key={rowIndex}>
                                        {activeTable.headers.map(header => (
                                            <td key={header} className="px-6 py-4 whitespace-nowrap text-sm" onDoubleClick={() => startEditing(activeTable.id, rowIndex, header)}>
                                                {editingCell?.tableId === activeTable.id && editingCell.rowIndex === rowIndex && editingCell.column === header ? (
                                                    <input
                                                        type="text"
                                                        value={editingValue}
                                                        onChange={e => setEditingValue(e.target.value)}
                                                        onBlur={handleSaveEdit}
                                                        onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                                                        autoFocus
                                                        className="w-full bg-transparent border-blue-500 ring-blue-500"
                                                    />
                                                ) : (
                                                    <span className="text-gray-700 dark:text-gray-300">{row[header]?.toString() ?? ''}</span>
                                                )}
                                            </td>
                                        ))}
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                            <div className="flex items-center gap-3">
                                                <button onClick={() => handleCopyRow(activeTable.id, rowIndex)} title="复制行" className="text-blue-600 hover:text-blue-900"><CopyIcon className="h-4 w-4" /></button>
                                                <button onClick={() => handleDeleteRow(activeTable.id, rowIndex)} title="删除行" className="text-red-600 hover:text-red-900"><Trash className="h-4 w-4" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                     <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                        <button onClick={() => handleAddRow(activeTable.id)} className="text-sm text-blue-600 hover:underline">
                            + 添加新行
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300 bg-gray-100 dark:bg-gray-900">
      <header className="flex-shrink-0 bg-white dark:bg-gray-800 shadow-md z-10">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Calculator className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <h1 className="ml-2 text-xl font-bold text-gray-900 dark:text-white">{appName}</h1>
            </div>
            <div className="flex items-center gap-2">
              <FileUpload onFileUpload={(file) => { 
                if (!mainTable) {                
                    const newTableId = crypto.randomUUID();
                    setTables([{ id: newTableId, name: "主表", data: [], headers: [], originalData: [] }]);
                    handleFileUpload(file, newTableId);
                } else {
                    handleFileUpload(file, mainTable.id);
                }
              }} disabled={isLoading} />
              <DownloadButton onDownload={() => mainTable && handleFileDownload(mainTable)} disabled={!mainTable || mainTable.data.length === 0 || isLoading} />
              <ResetButton onReset={() => mainTable && handleResetData(mainTable.id)} disabled={!mainTable || mainTable.originalData.length === 0} />
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1"></div>
               <input ref={importRulesInputRef} type="file" accept=".json" className="hidden" onChange={handleImportRules} />
               <input ref={importTemplateInputRef} type="file" accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={handleImportRulesFromTemplate} />
                <div className="relative" ref={importExportMenuRef}>
                  <button onClick={() => setIsImportExportOpen(prev => !prev)} className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                    <FileUp className="h-5 w-5" />
                  </button>
                  {isImportExportOpen && (
                    <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <div className="py-1">
                        <button onClick={handleDownloadRuleTemplate} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"><Download className="h-4 w-4" /><span>下载规则模板 (.xlsx)</span></button>
                        <button onClick={() => importTemplateInputRef.current?.click()} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"><FilePlus className="h-4 w-4" /><span>从模板导入规则</span></button>
                        <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />
                        <button onClick={handleExportRulesAsXlsx} disabled={ruleGroups.length === 0} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"><FileDown className="h-4 w-4" /><span>导出为 XLSX</span></button>
                        <button onClick={handleExportRules} disabled={ruleGroups.length === 0} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"><FileDown className="h-4 w-4" /><span>导出为 JSON</span></button>
                        <button onClick={() => importRulesInputRef.current?.click()} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"><FileUp className="h-4 w-4" /><span>从 JSON 导入</span></button>
                      </div>
                    </div>
                  )}
                </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow flex flex-col max-w-screen-2xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {isLoading && ( <div className="flex-grow flex items-center justify-center p-8 text-blue-500 dark:text-blue-400"><Loader className="w-8 h-8 animate-spin mr-3" /> <span className="text-lg">{loadingMessage}</span></div> )}
        {error && ( <div className="my-4 bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-md flex items-center"><AlertTriangle className="w-6 h-6 mr-3" /> <span>{error}</span><button onClick={() => setError(null)} className="ml-auto p-1 text-red-600 dark:text-red-200 rounded-full hover:bg-red-200 dark:hover:bg-red-800/50"><X className="h-4 w-4" /></button></div> )}
        
        {!isLoading && !error && (!mainTable || mainTable.originalData.length === 0) && (
          <div className="flex-grow flex items-center justify-center">
            <div className="text-center py-12">
                <UploadCloud className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-xl font-medium text-gray-900 dark:text-white">等待上传主表文件</h3>
                <p className="mt-1 text-md text-gray-500 dark:text-gray-400">上传 .xlsx 文件至主表以开始。</p>
            </div>
          </div>
        )}

        {!isLoading && mainTable && mainTable.originalData.length > 0 && (
          <div className="flex-grow flex flex-col h-full">
            <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 mb-4">
              <nav className="flex space-x-2" aria-label="Tabs">
                <TabButton isActive={activeView === 'table'} onClick={() => setActiveView('table')} icon={TableIcon} label="主数据表" />
                <TabButton isActive={activeView === 'customTables'} onClick={() => setActiveView('customTables')} icon={Settings2} label="自定义表格" />
                <TabButton isActive={activeView === 'fields'} onClick={() => setActiveView('fields')} icon={Baseline} label="字段管理" />
                <TabButton isActive={activeView === 'rules'} onClick={() => setActiveView('rules')} icon={SlidersHorizontal} label="批量规则" />
              </nav>
            </div>
            <div className="flex-grow" style={{ display: activeView === 'table' ? 'block' : 'none' }}>
                <DataTable 
                  data={paginatedData}
                  headers={mainTable.headers}
                  fileName={mainTable.name}
                  totalRows={mainTable.data.length}
                  currentPage={currentPage}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                />
            </div>
            <div className="flex-grow" style={{ display: activeView === 'customTables' ? 'flex' : 'none' }}>
              {renderCustomTablesView()}
            </div>
            <div className="flex-grow" style={{ display: activeView === 'fields' ? 'flex' : 'none' }}>
                <FieldManager tables={tables} onUpdate={handleTablesUpdate} />
            </div>
            <div className="flex-grow" style={{ display: activeView === 'rules' ? 'flex' : 'none' }}>
                <AllocationForm tables={tables} ruleGroups={ruleGroups} ruleCategories={ruleCategories} onRulesAndCategoriesChange={handleRulesAndCategoriesChange} onApply={handleApplyAllocation} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
