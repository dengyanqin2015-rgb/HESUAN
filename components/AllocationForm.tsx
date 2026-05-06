
// FIX: Import useEffect hook from React.
import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { RuleGroup, FilterCondition, FilterOperator, ActionType, AllocationAction, RuleCategory, Table, TableRow, LookupValueConfig, MultiMatchRule, MultiMatchConfig, InclusionMatchConfig, CrossColumnCalculationConfig, CrossColumnCalculationPart } from '../types';
import { Filter, PlusCircle, Trash2, ListChecks, DollarSign, Type, CheckSquare, Calculator, Layers, AlertCircle, ChevronDown, Sparkles, Copy, XCircle, Folder, FolderPlus, ChevronsDownUp, DatabaseZap, GitMerge, GripVertical, List } from 'lucide-react';

interface AllocationFormProps {
  tables: Table[];
  ruleGroups: RuleGroup[];
  ruleCategories: RuleCategory[];
  onRulesAndCategoriesChange: (newRuleGroups: RuleGroup[], newRuleCategories: RuleCategory[]) => void;
  onApply: () => void;
}

const operatorLabels: Record<FilterOperator, string> = {
  contains: '包含', not_contains: '不包含', equals: '等于', not_equals: '不等于', is_empty: '为空', is_not_empty: '不为空',
};

const createNewFilter = (isFirst: boolean = false): FilterCondition => ({ 
  id: crypto.randomUUID(), 
  column: '', 
  operator: 'contains', 
  value: '',
  ...(!isFirst && { logic: 'and' })
});

const createNewAction = (): AllocationAction => ({ 
    type: 'distribute_amount', 
    newColumnName: '', 
    totalAmount: undefined, 
    fillText: undefined, 
    aiPrompt: undefined,
    sourceType: 'manual',
    cellSource: {
        tableId: '',
        column: '',
        filters: [createNewFilter(true)]
    },
    lookupConfig: {
        sourceTableId: '',
        matches: [],
        sourceValueType: 'column',
        sourceValueColumn: '',
    },
    countDuplicatesConfig: {
        sourceColumn: ''
    },
    multiMatchConfig: {
        rules: [],
    },
    inclusionMatchConfig: {
        sourceTableId: '',
        mainSearchColumn: '',
        sourceMatchColumn: '',
        sourceValueColumn: '',
        matchDirection: 'main_contains_source',
    },
    crossColumnCalculationConfig: {
        parts: [
            { id: crypto.randomUUID(), columnName: '', openBrackets: 0, closeBrackets: 0 },
            { id: crypto.randomUUID(), columnName: '', operator: '+', openBrackets: 0, closeBrackets: 0 },
        ]
    }
});

const createNewRuleGroup = (): RuleGroup => ({
    id: crypto.randomUUID(),
    name: `新规则 #${Math.floor(Math.random() * 1000)}`,
    enabled: false,
    isCollapsed: false,
    filters: [createNewFilter(true)],
    action: createNewAction(),
});

const CellValueSourceEditor: React.FC<{
    action: AllocationAction;
    onActionChange: (newAction: AllocationAction) => void;
    tables: Table[];
}> = ({ action, onActionChange, tables }) => {
    
    const [lookupResult, setLookupResult] = useState<{ value: any; error: string | null }>({ value: null, error: null });

    const source = action.cellSource || { tableId: '', column: '', filters: [] };

    const findValue = useCallback(() => {
        if (!source.tableId || !source.column || source.filters.some(f => !f.column || (!['is_empty', 'is_not_empty'].includes(f.operator) && !f.value))) {
            setLookupResult({ value: null, error: "请完成所有筛选条件的配置。" });
            return;
        }

        const targetTable = tables.find(t => t.id === source.tableId);
        if (!targetTable) {
            setLookupResult({ value: null, error: "源表格未找到。" });
            return;
        }
        
        const checkRow = (row: TableRow, filters: FilterCondition[]) => {
            if (!filters || filters.length === 0) return true;
            const checkCondition = (filter: FilterCondition) => {
                const cellValue = row[filter.column] === null || row[filter.column] === undefined ? '' : String(row[filter.column]);
                const cellValueStr = cellValue.trim().toLowerCase();
                const filterValueStr = String(filter.value || '').trim().toLowerCase();
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
            let result = checkCondition(filters[0]);
            for (let i = 1; i < filters.length; i++) {
                const conditionResult = checkCondition(filters[i]);
                const logic = filters[i].logic || 'and';
                if (logic === 'and') result = result && conditionResult; else result = result || conditionResult;
            }
            return result;
        };

        const matchingRows = targetTable.data.filter(row => checkRow(row, source.filters));

        if (matchingRows.length === 0) {
            setLookupResult({ value: null, error: "未找到匹配行。" });
        } else if (matchingRows.length > 1) {
            setLookupResult({ value: null, error: `找到 ${matchingRows.length} 个匹配行，无法确定唯一值。` });
        } else {
            const value = matchingRows[0][source.column];
            if (value === undefined || value === null) {
                setLookupResult({ value: null, error: "找到的单元格为空。" });
            } else if (isNaN(parseFloat(String(value)))) {
                 setLookupResult({ value, error: "找到的值不是有效数字。" });
            }
            else {
                setLookupResult({ value, error: null });
            }
        }
    }, [source, tables]);

    useEffect(() => {
        findValue();
    }, [findValue]);

    const handleSourceChange = (field: keyof typeof source, value: any) => {
        const newSource = { ...source, [field]: value };
        onActionChange({ ...action, cellSource: newSource });
    };

    const handleFilterChange = (filterId: string, field: keyof FilterCondition, value: any) => {
        const newFilters = source.filters.map(f => f.id === filterId ? { ...f, [field]: value } : f);
        handleSourceChange('filters', newFilters);
    };
    
    const addFilter = () => {
        handleSourceChange('filters', [...source.filters, createNewFilter(source.filters.length === 0)]);
    };
    
    const removeFilter = (filterId: string) => {
        let newFilters = source.filters.filter(f => f.id !== filterId);
        if (newFilters.length > 0 && newFilters[0].logic) delete newFilters[0].logic;
        handleSourceChange('filters', newFilters);
    };

    const targetTableHeaders = tables.find(t => t.id === source.tableId)?.headers || [];

    return (
        <div className="mt-2 p-3 space-y-3 bg-blue-50 dark:bg-gray-700/50 border border-blue-200 dark:border-gray-600 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">1. 选择源表格</label>
                    <select value={source.tableId} onChange={e => handleSourceChange('tableId', e.target.value)} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2">
                        <option value="">-- 选择表格 --</option>
                        {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">3. 选择取值列</label>
                    <select value={source.column} onChange={e => handleSourceChange('column', e.target.value)} disabled={!source.tableId} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2 disabled:bg-gray-100 dark:disabled:bg-gray-600">
                        <option value="">-- 选择列 --</option>
                        {targetTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                </div>
            </div>
            <div>
                 <label className="text-xs font-medium text-gray-700 dark:text-gray-300">2. 设置筛选条件 (找到唯一行)</label>
                 <div className="mt-1 space-y-2 p-2 border border-dashed border-gray-300 dark:border-gray-600 rounded-md">
                     {source.filters.map((filter, index) => (
                         <React.Fragment key={filter.id}>
                          {index > 0 && (
                            <div className="flex justify-center my-1">
                                <select value={filter.logic || 'and'} onChange={(e) => handleFilterChange(filter.id, 'logic', e.target.value)} className="text-xs bg-gray-200 dark:bg-gray-800 border-0 rounded-md p-1 focus:ring-0">
                                    <option value="and">并且</option>
                                    <option value="or">或者</option>
                                </select>
                            </div>
                           )}
                           <div className="grid grid-cols-10 gap-2 items-center">
                                <select value={filter.column} onChange={e => handleFilterChange(filter.id, 'column', e.target.value)} className="col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full">
                                    <option value="">-- 列 --</option>
                                    {targetTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                                <select value={filter.operator} onChange={e => handleFilterChange(filter.id, 'operator', e.target.value as FilterOperator)} className="col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full">
                                    {Object.entries(operatorLabels).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
                                </select>
                                <input type="text" placeholder="值" value={filter.value} onChange={e => handleFilterChange(filter.id, 'value', e.target.value)} disabled={['is_empty', 'is_not_empty'].includes(filter.operator)} className="col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full disabled:bg-gray-100" />
                                <button type="button" onClick={() => removeFilter(filter.id)} className="col-span-1 text-red-500 hover:text-red-700 flex justify-center"><Trash2 className="w-4 h-4" /></button>
                           </div>
                         </React.Fragment>
                     ))}
                     <button type="button" onClick={addFilter} className="text-xs text-blue-600 hover:underline">+ 添加条件</button>
                 </div>
            </div>
            <div className={`p-2 rounded-md text-sm ${lookupResult.error ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300' : 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300'}`}>
                <strong>查找结果:</strong> {lookupResult.error ? lookupResult.error : `成功找到值 "${lookupResult.value}"`}
            </div>
        </div>
    );
};

const LookupValueEditor: React.FC<{
    config: AllocationAction['lookupConfig'];
    onConfigChange: (newConfig: AllocationAction['lookupConfig']) => void;
    tables: Table[];
    mainTableHeaders: string[];
}> = ({ config, onConfigChange, tables, mainTableHeaders }) => {
    const sourceTableHeaders = useMemo(() => {
        return tables.find(t => t.id === config?.sourceTableId)?.headers || [];
    }, [tables, config?.sourceTableId]);

    const handleFieldChange = (field: keyof LookupValueConfig, value: any) => {
        const newConfig = { ...config, [field]: value };
        if (field === 'sourceTableId') {
            newConfig.matches = [];
            newConfig.sourceValueColumn = '';
        }
        onConfigChange(newConfig);
    };

    const handleAddMatch = () => {
        onConfigChange({
            ...config,
            matches: [
                ...(config?.matches || []),
                { id: crypto.randomUUID(), mainColumn: '', sourceType: 'column', sourceValue: '', operator: 'equals', logic: 'and' }
            ]
        } as LookupValueConfig);
    };

    const handleRemoveMatch = (id: string) => {
        onConfigChange({
            ...config,
            matches: (config?.matches || []).filter(m => m.id !== id)
        } as LookupValueConfig);
    };

    const handleMatchChange = (id: string, field: keyof LookupMatchCondition, value: any) => {
        onConfigChange({
            ...config,
            matches: (config?.matches || []).map(m => m.id === id ? { ...m, [field]: value } : m)
        } as LookupValueConfig);
    };

    return (
        <div className="mt-2 p-3 space-y-3 bg-blue-50 dark:bg-gray-700/50 border border-blue-200 dark:border-gray-600 rounded-lg">
            <div>
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">1. 从哪个表查找数据?</label>
                <select value={config?.sourceTableId || ''} onChange={e => handleFieldChange('sourceTableId', e.target.value)} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2">
                    <option value="">-- 选择源表格 --</option>
                    {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
            </div>
            
            <div className="space-y-2">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">2. 设置匹配条件</label>
                {(config?.matches || []).map((match, index) => (
                    <div key={match.id} className="space-y-2">
                        {index > 0 && (
                            <div className="flex justify-center">
                                <select value={match.logic || 'and'} onChange={e => handleMatchChange(match.id, 'logic', e.target.value)} className="text-xs bg-gray-200 dark:bg-gray-800 border-0 rounded-md p-1 focus:ring-0">
                                    <option value="and">并且</option>
                                    <option value="or">或者</option>
                                </select>
                            </div>
                        )}
                        <div className="grid grid-cols-12 gap-2 items-center">
                            <select value={match.mainColumn} onChange={e => handleMatchChange(match.id, 'mainColumn', e.target.value)} className="col-span-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full">
                                <option value="">-- 主表列 --</option>
                                {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                            <select value={match.operator} onChange={e => handleMatchChange(match.id, 'operator', e.target.value)} className="col-span-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full">
                                <option value="equals">等于</option>
                                <option value="contains">包含</option>
                            </select>
                            <div className="col-span-5 flex gap-1">
                                <select value={match.sourceType} onChange={e => handleMatchChange(match.id, 'sourceType', e.target.value)} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-20">
                                    <option value="column">列</option>
                                    <option value="static">文本/数值</option>
                                </select>
                                {match.sourceType === 'column' ? (
                                    <select value={match.sourceValue} onChange={e => handleMatchChange(match.id, 'sourceValue', e.target.value)} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full">
                                        <option value="">-- 源表列 --</option>
                                        {sourceTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                ) : (
                                    <input type="text" value={match.sourceValue} onChange={e => handleMatchChange(match.id, 'sourceValue', e.target.value)} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full" placeholder="输入值" />
                                )}
                            </div>
                            <button type="button" onClick={() => handleRemoveMatch(match.id)} className="col-span-1 text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                        </div>
                    </div>
                ))}
                <button type="button" onClick={handleAddMatch} className="text-xs text-blue-600 hover:underline">+ 添加匹配条件</button>
            </div>

            <div className="grid grid-cols-12 gap-2">
                <label className="col-span-12 text-xs font-medium text-gray-700 dark:text-gray-300">3. 匹配成功后，取哪一列的值?</label>
                <div className="col-span-3">
                    <select value={config?.sourceValueType || 'column'} onChange={e => handleFieldChange('sourceValueType', e.target.value)} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-2 w-full">
                        <option value="column">源表列</option>
                        <option value="static">手动输入</option>
                    </select>
                </div>
                <div className="col-span-9">
                    {config?.sourceValueType === 'column' ? (
                        <select value={config?.sourceValueColumn || ''} onChange={e => handleFieldChange('sourceValueColumn', e.target.value)} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-2 w-full">
                            <option value="">-- 选择源表取值列 --</option>
                            {sourceTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                    ) : (
                        <input type="text" value={config?.sourceValueColumn || ''} onChange={e => handleFieldChange('sourceValueColumn', e.target.value)} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-2 w-full" placeholder="输入值" />
                    )}
                </div>
            </div>
             <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">注意: 匹配将自动忽略大小写和首尾空格。</p>
        </div>
    );
};


const MultiMatchEditor: React.FC<{
    config: MultiMatchConfig;
    onConfigChange: (newConfig: MultiMatchConfig) => void;
    mainTableHeaders: string[];
}> = ({ config, onConfigChange, mainTableHeaders }) => {
    
    const handleAddRule = () => {
        const newRule: MultiMatchRule = {
            id: crypto.randomUUID(),
            conditions: [createNewFilter(true)],
            sourceColumn: '',
        };
        onConfigChange({ ...config, rules: [...(config.rules || []), newRule] });
    };

    const handleUpdateRule = (ruleId: string, field: keyof MultiMatchRule, value: any) => {
        const newRules = (config.rules || []).map(r => r.id === ruleId ? { ...r, [field]: value } : r);
        onConfigChange({ ...config, rules: newRules });
    };

    const handleDeleteRule = (ruleId: string) => {
        const newRules = (config.rules || []).filter(r => r.id !== ruleId);
        onConfigChange({ ...config, rules: newRules });
    };

    const handleAddCondition = (ruleId: string) => {
        const rule = (config.rules || []).find(r => r.id === ruleId);
        if (rule) {
            const newConditions = [...rule.conditions, createNewFilter(rule.conditions.length === 0)];
            handleUpdateRule(ruleId, 'conditions', newConditions);
        }
    };
    
    const handleRemoveCondition = (ruleId: string, conditionId: string) => {
        const rule = (config.rules || []).find(r => r.id === ruleId);
        if (rule) {
            let newConditions = rule.conditions.filter(c => c.id !== conditionId);
            if (newConditions.length > 0 && newConditions[0].logic) {
                delete newConditions[0].logic;
            }
            handleUpdateRule(ruleId, 'conditions', newConditions);
        }
    };
    
    const handleConditionChange = (ruleId: string, conditionId: string, field: keyof FilterCondition, value: any) => {
        const rule = (config.rules || []).find(r => r.id === ruleId);
        if (rule) {
            const newConditions = rule.conditions.map(c => c.id === conditionId ? { ...c, [field]: value } : c);
            handleUpdateRule(ruleId, 'conditions', newConditions);
        }
    };

    return (
        <div className="mt-2 p-3 space-y-4 bg-blue-50 dark:bg-gray-700/50 border border-blue-200 dark:border-gray-600 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-300">按顺序定义多组匹配规则。对于主表的每一行，将从上到下检查这些规则，最后一个成功匹配的规则所指定的值将被填入目标列。</p>
            {(config.rules || []).map((rule, index) => (
                <div key={rule.id} className="p-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                            <GripVertical className="inline-block h-4 w-4 mr-1 text-gray-400" />
                            规则 #{index + 1}
                        </h4>
                        <button type="button" onClick={() => handleDeleteRule(rule.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    
                    <div className="space-y-3">
                        <div>
                             <label className="text-xs font-medium text-gray-700 dark:text-gray-300">如果满足以下条件:</label>
                             <div className="mt-1 space-y-2 p-2 border border-dashed border-gray-300 dark:border-gray-500 rounded-md">
                                 {rule.conditions.map((cond, condIndex) => (
                                     <React.Fragment key={cond.id}>
                                         {condIndex > 0 && (
                                              <div className="flex justify-center my-1">
                                                <select value={cond.logic || 'and'} onChange={(e) => handleConditionChange(rule.id, cond.id, 'logic', e.target.value)} className="text-xs bg-gray-200 dark:bg-gray-900 border-0 rounded-md p-1 focus:ring-0">
                                                    <option value="and">并且</option>
                                                    <option value="or">或者</option>
                                                </select>
                                              </div>
                                         )}
                                         <div className="grid grid-cols-10 gap-2 items-center">
                                            <select value={cond.column} onChange={e => handleConditionChange(rule.id, cond.id, 'column', e.target.value)} className="col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full">
                                                <option value="">-- 列 --</option>
                                                {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                            <select value={cond.operator} onChange={e => handleConditionChange(rule.id, cond.id, 'operator', e.target.value as FilterOperator)} className="col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full">
                                                {Object.entries(operatorLabels).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
                                            </select>
                                            <input type="text" placeholder="值" value={cond.value} onChange={e => handleConditionChange(rule.id, cond.id, 'value', e.target.value)} disabled={['is_empty', 'is_not_empty'].includes(cond.operator)} className="col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-1.5 w-full disabled:bg-gray-100" />
                                            <button type="button" onClick={() => handleRemoveCondition(rule.id, cond.id)} disabled={rule.conditions.length <= 1} className="col-span-1 text-red-500 hover:text-red-700 flex justify-center disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                                         </div>
                                     </React.Fragment>
                                 ))}
                                 <button type="button" onClick={() => handleAddCondition(rule.id)} className="text-xs text-blue-600 hover:underline">+ 添加条件</button>
                             </div>
                        </div>
                        <div>
                             <label className="text-xs font-medium text-gray-700 dark:text-gray-300">则从以下列取值:</label>
                             <select value={rule.sourceColumn} onChange={e => handleUpdateRule(rule.id, 'sourceColumn', e.target.value)} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2">
                                <option value="">-- 选择取值列 --</option>
                                {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                             </select>
                        </div>
                    </div>
                </div>
            ))}
             <button type="button" onClick={handleAddRule} className="w-full mt-2 inline-flex items-center justify-center px-3 py-2 border border-dashed border-gray-400 text-sm font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                <PlusCircle className="w-4 h-4 mr-2" />
                添加规则
            </button>
        </div>
    );
};

const InclusionMatchEditor: React.FC<{
    config: AllocationAction['inclusionMatchConfig'];
    onConfigChange: (newConfig: AllocationAction['inclusionMatchConfig']) => void;
    tables: Table[];
    mainTableHeaders: string[];
}> = ({ config, onConfigChange, tables, mainTableHeaders }) => {
    const sourceTableHeaders = useMemo(() => {
        return tables.find(t => t.id === config?.sourceTableId)?.headers || [];
    }, [tables, config?.sourceTableId]);

    const handleFieldChange = (field: keyof InclusionMatchConfig, value: string) => {
        const newConfig = { ...config, [field]: value };
        if (field === 'sourceTableId') {
            newConfig.sourceMatchColumn = '';
            newConfig.sourceValueColumn = '';
        }
        onConfigChange(newConfig);
    };

    const mainColName = config?.mainSearchColumn ? `“${config.mainSearchColumn}”` : '“主表匹配列”';
    const sourceColName = config?.sourceMatchColumn ? `“${config.sourceMatchColumn}”` : '“源表匹配列”';
    const helpText = (!config?.matchDirection || config.matchDirection === 'main_contains_source')
        ? `逻辑: 如果 ${mainColName} 的值包含了 ${sourceColName} 中任意一个单元格的值，则匹配成功。`
        : `逻辑: 如果 ${sourceColName} 中任意一个单元格的值包含了 ${mainColName} 的值，则匹配成功。`;


    return (
        <div className="mt-2 p-3 space-y-3 bg-blue-50 dark:bg-gray-700/50 border border-blue-200 dark:border-gray-600 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">1. 从哪个表查找数据?</label>
                    <select value={config?.sourceTableId || ''} onChange={e => handleFieldChange('sourceTableId', e.target.value)} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2">
                        <option value="">-- 选择源表格 --</option>
                        {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">2. 主表的哪一列用于匹配?</label>
                    <select value={config?.mainSearchColumn || ''} onChange={e => handleFieldChange('mainSearchColumn', e.target.value)} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2">
                        <option value="">-- 选择主表列 --</option>
                        {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                </div>
                 <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">3. 源表的哪一列用于匹配?</label>
                    <select value={config?.sourceMatchColumn || ''} onChange={e => handleFieldChange('sourceMatchColumn', e.target.value)} disabled={!config?.sourceTableId} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2 disabled:bg-gray-100 dark:disabled:bg-gray-600">
                        <option value="">-- 选择源表列 --</option>
                        {sourceTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                </div>
                 <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">4. 匹配成功后，取源表的哪一列的值?</label>
                    <select value={config?.sourceValueColumn || ''} onChange={e => handleFieldChange('sourceValueColumn', e.target.value)} disabled={!config?.sourceTableId} className="mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2 disabled:bg-gray-100 dark:disabled:bg-gray-600">
                        <option value="">-- 选择源表取值列 --</option>
                        {sourceTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2">
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">5. 匹配逻辑</label>
                    <div className="mt-1 flex items-center space-x-1 rounded-lg bg-gray-200 dark:bg-gray-900 p-1 w-full text-center">
                        <button type="button" onClick={() => handleFieldChange('matchDirection', 'main_contains_source')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${(!config?.matchDirection || config.matchDirection === 'main_contains_source') ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>
                            主表列 包含 源表列
                        </button>
                        <button type="button" onClick={() => handleFieldChange('matchDirection', 'source_contains_main')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${config?.matchDirection === 'source_contains_main' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>
                            源表列 包含 主表列
                        </button>
                    </div>
                </div>
            </div>
             <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{helpText}</p>
        </div>
    );
};

const CrossColumnCalculationEditor: React.FC<{
    config: CrossColumnCalculationConfig;
    onConfigChange: (newConfig: CrossColumnCalculationConfig) => void;
    mainTableHeaders: string[];
}> = ({ config, onConfigChange, mainTableHeaders }) => {
    
    const handleAddPart = () => {
        const newPart: CrossColumnCalculationPart = {
            id: crypto.randomUUID(),
            columnName: '',
            operator: '+',
            openBrackets: 0,
            closeBrackets: 0
        };
        onConfigChange({ ...config, parts: [...(config.parts || []), newPart] });
    };

    const handleUpdatePart = (partId: string, field: keyof CrossColumnCalculationPart, value: any) => {
        const newParts = (config.parts || []).map(p => p.id === partId ? { ...p, [field]: value } : p);
        onConfigChange({ ...config, parts: newParts });
    };

    const handleDeletePart = (partId: string) => {
        const newParts = (config.parts || []).filter(p => p.id !== partId);
        onConfigChange({ ...config, parts: newParts });
    };

    const previewFormula = useMemo(() => {
        if (!config.parts || config.parts.length === 0) return '';
        let formula = "";
        config.parts.forEach((part, index) => {
            if (index > 0 && part.operator) formula += ` ${part.operator} `;
            for(let i=0; i<(part.openBrackets || 0); i++) formula += "(";
            formula += part.columnName || "?";
            for(let i=0; i<(part.closeBrackets || 0); i++) formula += ")";
        });
        return formula;
    }, [config.parts]);

    return (
        <div className="mt-2 p-3 space-y-3 bg-blue-50 dark:bg-gray-700/50 border border-blue-200 dark:border-gray-600 rounded-lg">
            <div className="flex flex-col gap-1">
                <p className="text-xs text-gray-600 dark:text-gray-300">构建计算公式。遵循数学运算优先级：<strong>先乘除后加减</strong>，括号内优先计算。</p>
                {previewFormula && (
                    <div className="mt-1 p-2 bg-white/50 dark:bg-black/20 rounded border border-blue-100 dark:border-gray-500 font-mono text-[11px] text-blue-700 dark:text-blue-300 break-all">
                        <span className="text-gray-400 mr-1">预览:</span> {previewFormula}
                    </div>
                )}
                <p className="text-[10px] text-gray-500 italic">请确保括号成对出现，否则计算结果可能为0或错误。</p>
            </div>
            <div className="space-y-2">
                {(config.parts || []).map((part, index) => (
                    <div key={part.id} className="flex items-center gap-1.5 flex-wrap md:flex-nowrap">
                        {index > 0 && (
                            <select
                                value={part.operator || '+'}
                                onChange={e => handleUpdatePart(part.id, 'operator', e.target.value as CrossColumnCalculationPart['operator'])}
                                className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-2 font-mono w-14 shrink-0"
                            >
                                <option value="+">+</option>
                                <option value="-">-</option>
                                <option value="*">*</option>
                                <option value="/">/</option>
                            </select>
                        )}
                        
                        <div className="flex items-center border border-gray-300 dark:border-gray-500 rounded-lg overflow-hidden shrink-0">
                            <button 
                                type="button" 
                                title="增加左括号"
                                onClick={() => handleUpdatePart(part.id, 'openBrackets', (part.openBrackets || 0) + 1)}
                                className="w-7 h-9 flex items-center justify-center bg-gray-50 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs font-bold border-r border-gray-300 dark:border-gray-500"
                            >
                                (
                            </button>
                            <span className="w-5 text-center text-[10px] font-mono bg-white dark:bg-gray-700 h-9 flex items-center justify-center">{(part.openBrackets || 0) || 0}</span>
                            <button 
                                type="button" 
                                title="减少左括号"
                                onClick={() => handleUpdatePart(part.id, 'openBrackets', Math.max(0, (part.openBrackets || 0) - 1))}
                                className="w-7 h-9 flex items-center justify-center bg-gray-50 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs border-l border-gray-300 dark:border-gray-500"
                            >
                                -
                            </button>
                        </div>

                        <select
                            value={part.columnName}
                            onChange={e => handleUpdatePart(part.id, 'columnName', e.target.value)}
                            className="min-w-[120px] flex-grow bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg p-2"
                        >
                            <option value="">-- 选择列 --</option>
                            {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>

                        <div className="flex items-center border border-gray-300 dark:border-gray-500 rounded-lg overflow-hidden shrink-0">
                            <button 
                                type="button" 
                                title="增加右括号"
                                onClick={() => handleUpdatePart(part.id, 'closeBrackets', (part.closeBrackets || 0) + 1)}
                                className="w-7 h-9 flex items-center justify-center bg-gray-50 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs font-bold border-r border-gray-300 dark:border-gray-500"
                            >
                                )
                            </button>
                            <span className="w-5 text-center text-[10px] font-mono bg-white dark:bg-gray-700 h-9 flex items-center justify-center">{(part.closeBrackets || 0) || 0}</span>
                            <button 
                                type="button" 
                                title="减少右括号"
                                onClick={() => handleUpdatePart(part.id, 'closeBrackets', Math.max(0, (part.closeBrackets || 0) - 1))}
                                className="w-7 h-9 flex items-center justify-center bg-gray-50 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs border-l border-gray-300 dark:border-gray-500"
                            >
                                -
                            </button>
                        </div>
                        
                        <button
                            type="button"
                            onClick={() => handleDeletePart(part.id)}
                            disabled={(config.parts || []).length <= 2}
                            className="text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed p-2"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={handleAddPart}
                className="w-full mt-2 inline-flex items-center justify-center px-3 py-2 border border-dashed border-gray-400 text-sm font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
                <PlusCircle className="w-4 h-4 mr-2" />
                添加计算项
            </button>
        </div>
    );
};


const AllocationForm: React.FC<AllocationFormProps> = ({ tables, ruleGroups, ruleCategories, onRulesAndCategoriesChange, onApply }) => {
  const [selectedGroupIds, setSelectedGroupIds] = useState(new Set<string>());
  const [selectedFilterIds, setSelectedFilterIds] = useState(new Set<string>());
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryNameError, setCategoryNameError] = useState<{ id: string; message: string } | null>(null);

  const mainTableHeaders = useMemo(() => tables.length > 0 ? tables[0].headers : [], [tables]);
  
  const isFilterInvalid = useCallback((filter: FilterCondition): boolean => {
    if (!filter.column) return true;
    if (!['is_empty', 'is_not_empty'].includes(filter.operator) && !(filter.value || '').trim()) {
      return true;
    }
    return false;
  }, []);

    const isCellValueSourceInvalid = useCallback((source: AllocationAction['cellSource']): boolean => {
        if (!source) return true;
        if (!source.tableId || !source.column) return true;
        if (source.filters.length === 0 || source.filters.some(f => !f.column || (!['is_empty', 'is_not_empty'].includes(f.operator) && !f.value))) return true;
        
        // This is a simplified client-side check. The worker performs the real validation.
        const targetTable = tables.find(t => t.id === source.tableId);
        if (!targetTable) return true;
        // Cannot reliably check for uniqueness or value type here without significant performance cost.
        
        return false;
    }, [tables]);

  const isGroupContentInvalid = useCallback((group: RuleGroup): boolean => {
    if (!!group.validationError) return true;
    if (!group.action.newColumnName.trim()) return true;
    if (group.action.type === 'distribute_amount') {
        if (group.action.sourceType === 'manual' && (group.action.totalAmount === undefined || group.action.totalAmount <= 0)) return true;
        if (group.action.sourceType === 'cell' && isCellValueSourceInvalid(group.action.cellSource)) return true;
    }
    if (group.action.type === 'fill_text' && !(group.action.fillText || '').trim()) return true;
    if (group.action.type === 'group_sum') {
        const config = group.action.groupSumConfig;
        if (!config || !config.groupByColumn || !config.sumColumn) return true;
    }
    if (group.action.type === 'lookup_value') {
        const config = group.action.lookupConfig;
        if (!config || !config.sourceTableId || !config.matches || config.matches.length === 0 || config.matches.some(m => !m.mainColumn || !m.sourceValue) || !config.sourceValueColumn) return true;
    }
    if (group.action.type === 'count_duplicates') {
        const config = group.action.countDuplicatesConfig;
        if (!config || !config.sourceColumn) return true;
    }
    if (group.action.type === 'multi_match') {
        const config = group.action.multiMatchConfig;
        if (!config || !config.rules || config.rules.length === 0) return true;
        if (config.rules.some(rule => !rule.sourceColumn || rule.conditions.length === 0 || rule.conditions.some(isFilterInvalid))) return true;
    }
    if (group.action.type === 'inclusion_match') {
        const config = group.action.inclusionMatchConfig;
        if (!config || !config.sourceTableId || !config.mainSearchColumn || !config.sourceMatchColumn || !config.sourceValueColumn) return true;
    }
    if (group.action.type === 'cross_column_calculation') {
        const config = group.action.crossColumnCalculationConfig;
        if (!config || !config.parts || config.parts.length < 2) return true;
        if (config.parts.some((part, index) => {
            if (!part.columnName) return true;
            if (index > 0 && !part.operator) return true;
            return false;
        })) return true;
    }
    if (group.filters.length > 0 && group.filters.some(isFilterInvalid)) return true;
    return false;
  }, [isFilterInvalid, isCellValueSourceInvalid]);


  const updateGroup = (groupId: string, field: keyof Omit<RuleGroup, 'id'>, value: any) => {
    const newGroups = ruleGroups.map(g => g.id === groupId ? { ...g, [field]: value } : g);
    onRulesAndCategoriesChange(newGroups, ruleCategories);
  };

  const addRuleGroup = () => onRulesAndCategoriesChange([...ruleGroups, createNewRuleGroup()], ruleCategories);
  
  const addRuleGroupToCategory = (categoryId: string) => {
    const newGroup = createNewRuleGroup();
    const newRuleGroups = [...ruleGroups, newGroup];
    const newRuleCategories = ruleCategories.map(c => 
      c.id === categoryId 
        ? { ...c, ruleGroupIds: [...c.ruleGroupIds, newGroup.id] } 
        : c
    );
    onRulesAndCategoriesChange(newRuleGroups, newRuleCategories);
  };

  const removeRuleGroup = (groupId: string) => {
    const newRuleGroups = ruleGroups.filter(g => g.id !== groupId);
    const newRuleCategories = ruleCategories
      .map(c => ({
        ...c,
        ruleGroupIds: c.ruleGroupIds.filter(id => id !== groupId),
      }))
      .filter(c => c.ruleGroupIds.length > 0);
    onRulesAndCategoriesChange(newRuleGroups, newRuleCategories);
  };
  
  const handleSubmit = useCallback((e: React.FormEvent) => { e.preventDefault(); onApply(); }, [onApply]);

  const isFormInvalid = useMemo(() => {
    if (!!categoryNameError) return true;
    return ruleGroups.some(g => {
        if (!g.enabled) return false;
        return isGroupContentInvalid(g);
    });
  }, [ruleGroups, isGroupContentInvalid, categoryNameError]);
  
  const toggleSelection = (id: string, selectedSet: Set<string>, setSelectedSet: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const newSet = new Set(selectedSet);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedSet(newSet);
  };
  
  const handleSelectAllGroups = (checked: boolean) => {
    if (checked) {
        setSelectedGroupIds(new Set(ruleGroups.map(g => g.id)));
    } else {
        setSelectedGroupIds(new Set());
    }
  };

  const handleSelectAllInCategory = (categoryId: string, checked: boolean) => {
    const category = ruleCategories.find(c => c.id === categoryId);
    if (!category) return;

    const newSelectedIds = new Set(selectedGroupIds);
    if (checked) {
      category.ruleGroupIds.forEach(id => newSelectedIds.add(id));
    } else {
      category.ruleGroupIds.forEach(id => newSelectedIds.delete(id));
    }
    setSelectedGroupIds(newSelectedIds);
  };
  
  const handleDeleteSelectedGroups = () => {
    const newRuleGroups = ruleGroups.filter(g => !selectedGroupIds.has(g.id));
    const newRuleCategories = ruleCategories
      .map(c => ({
        ...c,
        ruleGroupIds: c.ruleGroupIds.filter(id => !selectedGroupIds.has(id)),
      }))
      .filter(c => c.ruleGroupIds.length > 0);
    onRulesAndCategoriesChange(newRuleGroups, newRuleCategories);
    setSelectedGroupIds(new Set());
  };

  const handleCopySelectedGroups = () => {
    const groupsToCopy = ruleGroups.filter(g => selectedGroupIds.has(g.id));
    const newClonedGroups: RuleGroup[] = [];
    const updatedCategories = JSON.parse(JSON.stringify(ruleCategories));

    const groupToCategoryMap = new Map<string, string>();
    ruleCategories.forEach(cat => cat.ruleGroupIds.forEach(id => groupToCategoryMap.set(id, cat.id)));

    for (const group of groupsToCopy) {
      const newGroup = {
        ...JSON.parse(JSON.stringify(group)),
        id: crypto.randomUUID(),
        name: `复制的 ${group.name}`,
        filters: group.filters.map((f: FilterCondition) => ({ ...f, id: crypto.randomUUID() })),
      };
      newClonedGroups.push(newGroup);

      const originalCategoryId = groupToCategoryMap.get(group.id);
      if (originalCategoryId) {
        const targetCategory = updatedCategories.find((c: RuleCategory) => c.id === originalCategoryId);
        if (targetCategory) {
          targetCategory.ruleGroupIds.push(newGroup.id);
        }
      }
    }

    onRulesAndCategoriesChange([...ruleGroups, ...newClonedGroups], updatedCategories);
    setSelectedGroupIds(new Set());
  };

  const handleBulkEnableSelected = () => {
    const newRuleGroups = ruleGroups.map(g => {
        if (selectedGroupIds.has(g.id)) {
            const isInvalid = isGroupContentInvalid(g);
            return { ...g, enabled: !isInvalid };
        }
        return g;
    });
    onRulesAndCategoriesChange(newRuleGroups, ruleCategories);
    setSelectedGroupIds(new Set());
  };

  const handleConfirmCreateCategory = () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName || selectedGroupIds.size === 0) {
      setIsCreatingCategory(false);
      setNewCategoryName('');
      return;
    }

    if (ruleCategories.some(c => c.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
        alert(`错误：分类名称 "${trimmedName}" 已存在。`);
        return;
    }

    const newCategory: RuleCategory = {
      id: crypto.randomUUID(),
      name: trimmedName,
      isCollapsed: false,
      ruleGroupIds: Array.from(selectedGroupIds),
    };

    const updatedCategories = ruleCategories.map(c => ({
      ...c,
      ruleGroupIds: c.ruleGroupIds.filter(id => !selectedGroupIds.has(id)),
    })).filter(c => c.ruleGroupIds.length > 0);

    onRulesAndCategoriesChange(ruleGroups, [...updatedCategories, newCategory]);
    setSelectedGroupIds(new Set());
    setIsCreatingCategory(false);
    setNewCategoryName('');
  };

  const handleDeleteCategory = useCallback((categoryId: string) => {
    const categoryToDelete = ruleCategories.find(c => c.id === categoryId);
    if (!categoryToDelete) return;

    const confirmationMessage = `确定要删除分类 "${categoryToDelete.name}" 吗？\n\n这将永久删除该分类及其包含的所有 ${categoryToDelete.ruleGroupIds.length} 个规则。`;

    if (window.confirm(confirmationMessage)) {
        const ruleIdsToDelete = new Set(categoryToDelete.ruleGroupIds);
        
        const newRuleGroups = ruleGroups.filter(g => !ruleIdsToDelete.has(g.id));
        const newRuleCategories = ruleCategories.filter(c => c.id !== categoryId);
        
        const newSelectedGroupIds = new Set(selectedGroupIds);
        ruleIdsToDelete.forEach(id => newSelectedGroupIds.delete(id));
        setSelectedGroupIds(newSelectedGroupIds);

        onRulesAndCategoriesChange(newRuleGroups, newRuleCategories);
    }
  }, [ruleCategories, ruleGroups, selectedGroupIds, onRulesAndCategoriesChange]);
  
  const handleUpdateCategory = (categoryId: string, field: keyof Omit<RuleCategory, 'id' | 'ruleGroupIds'>, value: any) => {
      const newCategories = ruleCategories.map(c => c.id === categoryId ? { ...c, [field]: value } : c);

      if (field === 'name') {
          const trimmedName = String(value).trim().toLowerCase();
          const isDuplicate = trimmedName && ruleCategories.some(c => c.id !== categoryId && c.name.trim().toLowerCase() === trimmedName);
          
          if (isDuplicate) {
              setCategoryNameError({ id: categoryId, message: '该分类名称已存在。' });
          } else if (categoryNameError && categoryNameError.id === categoryId) {
              setCategoryNameError(null);
          }
      }

      onRulesAndCategoriesChange(ruleGroups, newCategories);
  };

   const handleMoveGroupToCategory = (groupId: string, targetCategoryId: string) => {
      let newCategories = ruleCategories.map(c => ({
        ...c,
        ruleGroupIds: c.ruleGroupIds.filter(id => id !== groupId)
      }));
      
      if (targetCategoryId && targetCategoryId !== '__TOP_LEVEL__') {
        const targetCategory = newCategories.find(c => c.id === targetCategoryId);
        if (targetCategory) {
          targetCategory.ruleGroupIds.push(groupId);
        }
      }

      newCategories = newCategories.filter(c => c.ruleGroupIds.length > 0);
      
      onRulesAndCategoriesChange(ruleGroups, newCategories);
    };

  const handleToggleAll = (collapse: boolean) => {
    const newRuleGroups = ruleGroups.map(g => ({ ...g, isCollapsed: collapse }));
    const newRuleCategories = ruleCategories.map(c => ({ ...c, isCollapsed: collapse }));
    onRulesAndCategoriesChange(newRuleGroups, newRuleCategories);
  };
  
  const ruleGroupIdsInCategories = useMemo(() => new Set(ruleCategories.flatMap(c => c.ruleGroupIds)), [ruleCategories]);
  const topLevelRuleGroups = useMemo(() => ruleGroups.filter(g => !ruleGroupIdsInCategories.has(g.id)), [ruleGroups, ruleGroupIdsInCategories]);
  const groupToCategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    ruleCategories.forEach(cat => cat.ruleGroupIds.forEach(id => map.set(id, cat.id)));
    return map;
  }, [ruleCategories]);

  const handleCopyRuleGroup = (groupId: string) => {
    const groupToCopy = ruleGroups.find(g => g.id === groupId);
    if (!groupToCopy) return;

    const newGroup: RuleGroup = {
      ...JSON.parse(JSON.stringify(groupToCopy)),
      id: crypto.randomUUID(),
      name: `复制的 ${groupToCopy.name}`,
      filters: groupToCopy.filters.map((f: FilterCondition) => ({ ...f, id: crypto.randomUUID() })),
      enabled: false,
      isCollapsed: false,
    };

    const originalIndex = ruleGroups.findIndex(g => g.id === groupId);
    
    const newRuleGroups = [...ruleGroups];
    newRuleGroups.splice(originalIndex + 1, 0, newGroup);

    const originalCategoryId = groupToCategoryMap.get(groupId);
    let newRuleCategories = [...ruleCategories];

    if (originalCategoryId) {
      newRuleCategories = ruleCategories.map(cat => {
        if (cat.id === originalCategoryId) {
          const originalGroupIndexInCat = cat.ruleGroupIds.indexOf(groupId);
          const newRuleGroupIds = [...cat.ruleGroupIds];
          newRuleGroupIds.splice(originalGroupIndexInCat + 1, 0, newGroup.id);
          return { ...cat, ruleGroupIds: newRuleGroupIds };
        }
        return cat;
      });
    }
    
    onRulesAndCategoriesChange(newRuleGroups, newRuleCategories);
  };
  
    const handleCopyCategory = (categoryId: string) => {
    const categoryToCopy = ruleCategories.find(c => c.id === categoryId);
    if (!categoryToCopy) return;

    const newCategoryId = crypto.randomUUID();
    const groupCopies = new Map<string, RuleGroup>();

    const originalGroups = ruleGroups.filter(g => categoryToCopy.ruleGroupIds.includes(g.id));

    originalGroups.forEach(group => {
      const newGroup: RuleGroup = {
        ...JSON.parse(JSON.stringify(group)),
        id: crypto.randomUUID(),
        name: `复制的 ${group.name}`,
        filters: group.filters.map((f: FilterCondition) => ({ ...f, id: crypto.randomUUID() })),
        enabled: false,
        isCollapsed: true,
      };
      groupCopies.set(group.id, newGroup);
    });

    const newCategory: RuleCategory = {
      id: newCategoryId,
      name: `复制的 ${categoryToCopy.name}`,
      isCollapsed: false,
      ruleGroupIds: originalGroups.map(g => groupCopies.get(g.id)!.id),
    };

    const originalCategoryIndex = ruleCategories.findIndex(c => c.id === categoryId);
    
    const newRuleGroups = [...ruleGroups, ...Array.from(groupCopies.values())];
    const newRuleCategories = [...ruleCategories];
    newRuleCategories.splice(originalCategoryIndex + 1, 0, newCategory);

    onRulesAndCategoriesChange(newRuleGroups, newRuleCategories);
  };

  const renderRuleGroup = (group: RuleGroup) => {
    const isInvalid = isGroupContentInvalid(group);
    const statusClass = isInvalid ? 'bg-red-500' : group.enabled ? 'bg-green-500' : 'bg-gray-400';
    const statusTitle = isInvalid ? '规则组异常' : group.enabled ? '规则组已启用' : '规则组已禁用';
    const selectedFiltersCountInGroup = group.filters.filter(f => selectedFilterIds.has(f.id)).length;
    
    const toggleCollapse = (groupId: string) => updateGroup(groupId, 'isCollapsed', !group.isCollapsed);
    const addFilter = (groupId: string) => updateGroup(groupId, 'filters', [...group.filters, createNewFilter(group.filters.length === 0)]);

    const removeFilter = (groupId: string, filterId: string) => {
      let newFilters = group.filters.filter(f => f.id !== filterId);
      if (newFilters.length > 0 && newFilters[0].logic) delete newFilters[0].logic;
      updateGroup(groupId, 'filters', newFilters);
    };

    const handleFilterChange = (groupId: string, filterId: string, field: keyof Omit<FilterCondition, 'id'>, value: string) => {
      const newFilters = group.filters.map(f => f.id === filterId ? { ...f, [field]: value } : f);
      updateGroup(groupId, 'filters', newFilters);
    };

    const handleActionChange = (groupId: string, field: keyof AllocationAction, value: any) => {
        const newAction = { ...group.action, [field]: value };
        if (field === 'type') {
          newAction.totalAmount = undefined;
          newAction.fillText = undefined;
          newAction.aiPrompt = undefined;
          newAction.lookupConfig = undefined;
          newAction.countDuplicatesConfig = undefined;
          newAction.multiMatchConfig = undefined;
          newAction.inclusionMatchConfig = undefined;
          newAction.crossColumnCalculationConfig = undefined;

          if (value === 'lookup_value') {
              newAction.lookupConfig = {
                  sourceTableId: '', mainMatchColumn: '', sourceMatchColumn: '', sourceValueColumn: ''
              };
          }
          if (value === 'count_duplicates') {
            newAction.countDuplicatesConfig = { sourceColumn: '' };
          }
          if (value === 'multi_match') {
              newAction.multiMatchConfig = { rules: [] };
          }
          if (value === 'inclusion_match') {
              newAction.inclusionMatchConfig = { sourceTableId: '', mainSearchColumn: '', sourceMatchColumn: '', sourceValueColumn: '', matchDirection: 'main_contains_source'};
          }
          if (value === 'cross_column_calculation') {
              newAction.crossColumnCalculationConfig = {
                  parts: [
                      { id: crypto.randomUUID(), columnName: '' },
                      { id: crypto.randomUUID(), columnName: '', operator: '+' },
                  ]
              };
          }
        }
        if (field === 'sourceType') {
           newAction.totalAmount = undefined;
        }
        updateGroup(groupId, 'action', newAction);
    };
    
     const handleNestedActionChange = (groupId: string, newAction: AllocationAction) => {
        updateGroup(groupId, 'action', newAction);
    };

    const handleLookupConfigChange = (groupId: string, newConfig: AllocationAction['lookupConfig']) => {
      const newAction = { ...group.action, lookupConfig: newConfig };
      updateGroup(groupId, 'action', newAction);
    };
    
    const handleMultiMatchConfigChange = (groupId: string, newConfig: AllocationAction['multiMatchConfig']) => {
        const newAction = { ...group.action, multiMatchConfig: newConfig };
        updateGroup(groupId, 'action', newAction);
    };
    
    const handleInclusionMatchConfigChange = (groupId: string, newConfig: AllocationAction['inclusionMatchConfig']) => {
        const newAction = { ...group.action, inclusionMatchConfig: newConfig };
        updateGroup(groupId, 'action', newAction);
    };

    const handleCrossColumnCalculationConfigChange = (groupId: string, newConfig: AllocationAction['crossColumnCalculationConfig']) => {
        const newAction = { ...group.action, crossColumnCalculationConfig: newConfig };
        updateGroup(groupId, 'action', newAction);
    };

    const handleSelectAllFiltersInGroup = (groupId: string, checked: boolean) => {
      const filterIdsInGroup = group.filters.map(f => f.id);
      const newSet = new Set(selectedFilterIds);
      if (checked) filterIdsInGroup.forEach(id => newSet.add(id));
      else filterIdsInGroup.forEach(id => newSet.delete(id));
      setSelectedFilterIds(newSet);
    };
    
    const handleBulkActionForFilters = (groupId: string, action: 'copy' | 'delete') => {
      const filtersToActOn = group.filters.filter(f => selectedFilterIds.has(f.id));
      if (filtersToActOn.length === 0) return;

      let newFilters;
      if (action === 'copy') {
          const copiedFilters = filtersToActOn.map(f => ({ ...f, id: crypto.randomUUID() }));
          newFilters = [...group.filters, ...copiedFilters];
      } else { // delete
          newFilters = group.filters.filter(f => !selectedFilterIds.has(f.id));
          if (newFilters.length > 0 && newFilters[0].logic) delete newFilters[0].logic;
      }
      
      const newSelectedFilterIds = new Set(selectedFilterIds);
      filtersToActOn.forEach(f => newSelectedFilterIds.delete(f.id));
      setSelectedFilterIds(newSelectedFilterIds);
      
      updateGroup(groupId, 'filters', newFilters);
    };

    return (
        <div key={group.id} className={`bg-gray-50 dark:bg-gray-800/50 border rounded-lg shadow-sm transition-all duration-300 ${group.enabled && !isInvalid ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
            <div className="flex items-center p-3">
                <input type="checkbox" checked={selectedGroupIds.has(group.id)} onChange={() => toggleSelection(group.id, selectedGroupIds, setSelectedGroupIds)} className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-3 flex-shrink-0" onClick={e => e.stopPropagation()} />
                <div title={statusTitle} className={`w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0 ${statusClass}`} />
                <div className="flex items-center flex-grow cursor-pointer" onClick={() => toggleCollapse(group.id)}>
                <ChevronDown className={`w-5 h-5 mr-2 text-gray-400 transition-transform duration-200 ${!group.isCollapsed ? 'rotate-180' : ''}`} />
                <Layers className={`w-5 h-5 mr-2 flex-shrink-0 ${group.enabled && !isInvalid ? 'text-blue-500' : 'text-gray-400'}`} />
                <input type="text" value={group.name} onChange={e => updateGroup(group.id, 'name', e.target.value)} onClick={e => e.stopPropagation()} placeholder="为规则组命名" className="text-md font-semibold text-gray-800 dark:text-gray-200 bg-transparent focus:outline-none focus:ring-0 border-0 border-b-2 border-transparent focus:border-blue-500 flex-grow" />
                </div>
                <div className="flex items-center gap-2 ml-auto" onClick={e => e.stopPropagation()}>
                <select
                    value={groupToCategoryMap.get(group.id) || '__TOP_LEVEL__'}
                    onChange={(e) => handleMoveGroupToCategory(group.id, e.target.value)}
                    title="移动到分类"
                    className="text-xs bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md p-1 focus:ring-blue-500 focus:border-blue-500">
                    <option value="__TOP_LEVEL__">无分类</option>
                    {ruleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <label htmlFor={`enable-switch-${group.id}`} className="flex items-center cursor-pointer"><span className={`mr-2 text-xs font-medium ${group.enabled && !isInvalid ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}>{group.enabled && !isInvalid ? '已启用' : '已禁用'}</span><div className="relative"><input type="checkbox" id={`enable-switch-${group.id}`} className="sr-only" checked={group.enabled} onChange={e => updateGroup(group.id, 'enabled', e.target.checked)} disabled={isInvalid} /><div className={`block w-10 h-5 rounded-full transition-colors ${group.enabled && !isInvalid ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} ${isInvalid ? 'cursor-not-allowed opacity-50' : ''}`}></div><div className={`dot absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform ${group.enabled && !isInvalid ? 'translate-x-5' : ''}`}></div></div></label>
                <button type="button" onClick={() => handleCopyRuleGroup(group.id)} title="复制规则" className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-400">
                  <Copy className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => removeRuleGroup(group.id)} className="text-red-500 hover:text-red-700 dark:hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
            </div>
            {!group.isCollapsed && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                {group.validationError && ( <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-sm rounded-md flex items-center"><AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" /><span><strong>验证失败:</strong> {group.validationError}</span></div> )}
                <fieldset className="border border-gray-200 dark:border-gray-600 rounded-md p-3 mb-4">
                <legend className="px-2 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center"><Filter className="w-4 h-4 mr-2" /> 筛选条件</legend>
                <div className="flex items-center justify-between my-2">
                    <label className="flex items-center text-xs text-gray-600 dark:text-gray-300">
                        <input type="checkbox" onChange={(e) => handleSelectAllFiltersInGroup(group.id, e.target.checked)} checked={group.filters.length > 0 && group.filters.every(f => selectedFilterIds.has(f.id))} className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                        <span className="ml-2">全选</span>
                    </label>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => handleBulkActionForFilters(group.id, 'copy')} disabled={selectedFiltersCountInGroup === 0} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"><Copy className="w-3 h-3"/>复制</button>
                        <button type="button" onClick={() => handleBulkActionForFilters(group.id, 'delete')} disabled={selectedFiltersCountInGroup === 0} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md text-red-600 bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800/50 disabled:opacity-50"><XCircle className="w-3 h-3"/>删除</button>
                    </div>
                </div>
                <div className="space-y-3 mt-2">{group.filters.map((filter, index) => (
                <React.Fragment key={filter.id}>
                    {index > 0 && (
                        <div className="flex justify-center my-2">
                            <div className="flex items-center space-x-1 rounded-lg bg-gray-200 dark:bg-gray-900 p-1 text-center text-xs font-medium w-32">
                            <button type="button" onClick={() => handleFilterChange(group.id, filter.id, 'logic', 'and')} className={`w-1/2 rounded-md py-1 ${filter.logic === 'and' || !filter.logic ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>并且</button>
                            <button type="button" onClick={() => handleFilterChange(group.id, filter.id, 'logic', 'or')} className={`w-1/2 rounded-md py-1 ${filter.logic === 'or' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>或者</button>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-11 gap-2 items-center">
                        <div className="md:col-span-1 flex items-center justify-center">
                            <input type="checkbox" checked={selectedFilterIds.has(filter.id)} onChange={() => toggleSelection(filter.id, selectedFilterIds, setSelectedFilterIds)} className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                            <div title={isFilterInvalid(filter) ? '规则异常' : '规则正常'} className={`w-2 h-2 rounded-full ml-2 flex-shrink-0 ${isFilterInvalid(filter) ? 'bg-red-500' : 'bg-green-500'}`} />
                        </div>
                        <select value={filter.column} onChange={e => handleFilterChange(group.id, filter.id, 'column', e.target.value)} className="md:col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2">
                            <option value="">-- 选择列 --</option>
                            {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <select value={filter.operator} onChange={e => handleFilterChange(group.id, filter.id, 'operator', e.target.value as FilterOperator)} className="md:col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2">{Object.entries(operatorLabels).map(([op, label]) => <option key={op} value={op}>{label}</option>)}</select>
                        <input type="text" placeholder="输入值" value={filter.value} onChange={e => handleFilterChange(group.id, filter.id, 'value', e.target.value)} disabled={!filter.column || ['is_empty', 'is_not_empty'].includes(filter.operator)} className="md:col-span-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2 disabled:bg-gray-100 dark:disabled:bg-gray-600" />
                        <button type="button" onClick={() => removeFilter(group.id, filter.id)} className="md:col-span-1 text-red-500 hover:text-red-700 disabled:opacity-50 flex justify-center items-center" disabled={group.filters.length <= 1 && !selectedFilterIds.has(filter.id)}><Trash2 className="w-5 h-5" /></button>
                    </div>
                </React.Fragment>
                ))}
                    <div className="mt-4 flex items-center justify-between">
                    <button type="button" onClick={() => addFilter(group.id)} className="inline-flex items-center px-2 py-1 border border-dashed border-gray-400 text-xs font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"><PlusCircle className="w-4 h-4 mr-1" /> 添加条件</button>
                    </div>
                </div>
                </fieldset>
                <fieldset className="border border-gray-200 dark:border-gray-600 rounded-md p-3"><legend className="px-2 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center"><ListChecks className="w-4 h-4 mr-2" /> 执行操作</legend><div className="space-y-4 mt-2"><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center"><CheckSquare className="w-4 h-4 mr-1" /> 操作类型</label><div className="flex flex-wrap items-center gap-1 rounded-lg bg-gray-200 dark:bg-gray-900 p-1 w-full text-center"><button type="button" onClick={() => handleActionChange(group.id, 'type', 'distribute_amount')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'distribute_amount' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>平摊金额</button><button type="button" onClick={() => handleActionChange(group.id, 'type', 'fill_text')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'fill_text' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>填充文本</button><button type="button" onClick={() => handleActionChange(group.id, 'type', 'lookup_value')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'lookup_value' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>查询匹配</button><button type="button" onClick={() => handleActionChange(group.id, 'type', 'inclusion_match')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'inclusion_match' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>包含匹配</button><button type="button" onClick={() => handleActionChange(group.id, 'type', 'multi_match')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'multi_match' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>多维匹配</button><button type="button" onClick={() => handleActionChange(group.id, 'type', 'count_duplicates')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'count_duplicates' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>列重复统计</button><button type="button" onClick={() => handleActionChange(group.id, 'type', 'cross_column_calculation')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'cross_column_calculation' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>跨列计算</button><button type="button" onClick={() => handleActionChange(group.id, 'type', 'group_sum')} className={`flex-1 rounded-md py-1.5 px-2 text-xs font-medium ${group.action.type === 'group_sum' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>分组求和</button></div></div><div><label htmlFor={`target-column-${group.id}`} className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300"><Type className="w-4 h-4 mr-1" /> 目标列</label><input type="text" id={`target-column-${group.id}`} list={`headers-list-${group.id}`} value={group.action.newColumnName} onChange={e => handleActionChange(group.id, 'newColumnName', e.target.value)} placeholder="选择或新建列名" required className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2" /><datalist id={`headers-list-${group.id}`}>{mainTableHeaders.map(h => <option key={h} value={h} />)}</datalist></div></div>
                {group.action.type === 'distribute_amount' && (<div>
                     <label className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300"><DollarSign className="w-4 h-4 mr-1" /> 总金额来源</label>
                     <div className="flex items-center space-x-1 rounded-lg bg-gray-200 dark:bg-gray-900 p-1 w-full text-center">
                         <button type="button" onClick={() => handleActionChange(group.id, 'sourceType', 'manual')} className={`flex-1 rounded-md py-1.5 text-xs font-medium ${group.action.sourceType === 'manual' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>手动输入</button>
                         <button type="button" onClick={() => handleActionChange(group.id, 'sourceType', 'cell')} className={`flex-1 rounded-md py-1.5 text-xs font-medium ${group.action.sourceType === 'cell' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow' : 'hover:bg-white/50'}`}>从单元格获取</button>
                     </div>
                    {group.action.sourceType === 'manual' && (
                        <input type="number" id={`total-amount-${group.id}`} value={group.action.totalAmount || ''} onChange={e => handleActionChange(group.id, 'totalAmount', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="例如: 10000" min="0.01" step="0.01" required className="mt-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2" />
                    )}
                    {group.action.sourceType === 'cell' && (
                       <CellValueSourceEditor
                           action={group.action}
                           onActionChange={(newAction) => handleNestedActionChange(group.id, newAction)}
                           tables={tables}
                       />
                    )}
                </div>)}
                {group.action.type === 'fill_text' && (<div><label htmlFor={`fill-text-${group.id}`} className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300"><Type className="w-4 h-4 mr-1" /> 输入文本</label><input type="text" id={`fill-text-${group.id}`} value={group.action.fillText || ''} onChange={e => handleActionChange(group.id, 'fillText', e.target.value)} placeholder="例如: 合格" required className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2" /></div>)}
                {group.action.type === 'lookup_value' && (
                    <div>
                        <label className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                            <DatabaseZap className="w-4 h-4 mr-1" /> 配置值查找
                        </label>
                        <LookupValueEditor
                            config={group.action.lookupConfig}
                            onConfigChange={(newConfig) => handleLookupConfigChange(group.id, newConfig)}
                            tables={tables}
                            mainTableHeaders={mainTableHeaders}
                        />
                    </div>
                )}
                {group.action.type === 'inclusion_match' && (
                     <div>
                        <label className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                            <DatabaseZap className="w-4 h-4 mr-1" /> 配置包含匹配
                        </label>
                        <InclusionMatchEditor
                            config={group.action.inclusionMatchConfig!}
                            onConfigChange={(newConfig) => handleInclusionMatchConfigChange(group.id, newConfig)}
                            tables={tables}
                            mainTableHeaders={mainTableHeaders}
                        />
                    </div>
                )}
                {group.action.type === 'multi_match' && (
                     <div>
                        <label className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                            <GitMerge className="w-4 h-4 mr-1" /> 配置多维匹配规则
                        </label>
                        <MultiMatchEditor
                            config={group.action.multiMatchConfig!}
                            onConfigChange={(newConfig) => handleMultiMatchConfigChange(group.id, newConfig)}
                            mainTableHeaders={mainTableHeaders}
                        />
                    </div>
                )}
                {group.action.type === 'count_duplicates' && (<div>
                     <label htmlFor={`count-duplicates-source-${group.id}`} className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                        <Layers className="w-4 h-4 mr-1" /> 选择要统计的列
                     </label>
                     <select 
                        id={`count-duplicates-source-${group.id}`}
                        value={group.action.countDuplicatesConfig?.sourceColumn || ''}
                        onChange={e => handleActionChange(group.id, 'countDuplicatesConfig', { sourceColumn: e.target.value })}
                        className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2"
                     >
                        <option value="">-- 选择列 --</option>
                        {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                     </select>
                     <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">注意: 统计将自动忽略大小写和首尾空格。</p>
                </div>
                )}
                 {group.action.type === 'cross_column_calculation' && (
                    <div>
                        <label className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                            <Calculator className="w-4 h-4 mr-1" /> 配置跨列计算
                        </label>
                        <CrossColumnCalculationEditor
                            config={group.action.crossColumnCalculationConfig!}
                            onConfigChange={(newConfig) => handleCrossColumnCalculationConfigChange(group.id, newConfig)}
                            mainTableHeaders={mainTableHeaders}
                        />
                    </div>
                )}
                {group.action.type === 'group_sum' && (
                  <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
                      <div>
                          <label className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                              <List className="w-4 h-4 mr-1" /> 分组列 (如: 内部订单号)
                          </label>
                          <select 
                              value={group.action.groupSumConfig?.groupByColumn || ''} 
                              onChange={e => {
                                  const config = group.action.groupSumConfig || { groupByColumn: '', sumColumn: '' };
                                  handleActionChange(group.id, 'groupSumConfig', { ...config, groupByColumn: e.target.value });
                              }} 
                              required 
                              className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2"
                          >
                              <option value="">-- 选择列 --</option>
                              {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="flex items-center mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                              <Calculator className="w-4 h-4 mr-1" /> 求和列 (如: 成本价)
                          </label>
                          <select 
                              value={group.action.groupSumConfig?.sumColumn || ''} 
                              onChange={e => {
                                  const config = group.action.groupSumConfig || { groupByColumn: '', sumColumn: '' };
                                  handleActionChange(group.id, 'groupSumConfig', { ...config, sumColumn: e.target.value });
                              }} 
                              required 
                              className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-sm rounded-lg block w-full p-2"
                          >
                              <option value="">-- 选择列 --</option>
                              {mainTableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                          </select>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">注意: 此操作会将包含相同分组列值的所有的行的求和列值相加，并将结果输出到目标列。</p>
                  </div>
                )}
                </div></fieldset>
            </div>
            )}
        </div>
    )
  };

  const renderActionBar = (position: 'top' | 'bottom') => {
    const borderClass = position === 'top' 
        ? 'border-b border-gray-200 dark:border-gray-700' 
        : 'border-t border-gray-200 dark:border-gray-700';
    
    return (
        <div className={`flex-shrink-0 p-4 bg-gray-50 dark:bg-gray-800/50 ${borderClass}`}>
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className='flex items-center gap-2 flex-wrap'>
              <button type="button" onClick={addRuleGroup} className="inline-flex items-center justify-center px-4 py-2 border border-dashed border-gray-400 text-sm font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                <PlusCircle className="w-5 h-5 mr-2" /> 添加规则组
              </button>
              {!isCreatingCategory ? (
                  <button type="button" onClick={() => setIsCreatingCategory(true)} disabled={selectedGroupIds.size === 0} className="inline-flex items-center justify-center px-4 py-2 border border-dashed border-gray-400 text-sm font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">
                      <FolderPlus className="w-5 h-5 mr-2" /> 创建分类
                  </button>
              ) : (
                  <div className="flex items-center gap-2 p-1.5 border border-blue-300 rounded-md bg-blue-50 dark:bg-gray-700">
                      <input 
                          type="text" 
                          value={newCategoryName}
                          onChange={e => setNewCategoryName(e.target.value)}
                          placeholder="输入分类名称..."
                          className="bg-white dark:bg-gray-600 border-gray-300 dark:border-gray-500 text-sm rounded-md block w-full p-1 focus:ring-blue-500 focus:border-blue-500"
                          autoFocus
                          onKeyDown={e => {if (e.key === 'Enter') handleConfirmCreateCategory()}}
                      />
                      <button type="button" onClick={handleConfirmCreateCategory} className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">确认</button>
                      <button type="button" onClick={() => {setIsCreatingCategory(false); setNewCategoryName('')}} className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300">取消</button>
                  </div>
              )}
              <div className="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
                <button type="button" onClick={() => handleToggleAll(false)} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"><ChevronsDownUp className="w-4 h-4"/>全部展开</button>
                <button type="button" onClick={() => handleToggleAll(true)} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"><ChevronsDownUp className="w-4 h-4 rotate-180"/>全部折叠</button>
              <div className="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
              <label className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                <input type="checkbox" onChange={e => handleSelectAllGroups(e.target.checked)} checked={ruleGroups.length > 0 && selectedGroupIds.size === ruleGroups.length} className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                <span className="ml-2">全选</span>
              </label>
               <button type="button" onClick={handleBulkEnableSelected} disabled={selectedGroupIds.size === 0} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"><CheckSquare className="w-4 h-4"/>批量启用</button>
              <button type="button" onClick={handleCopySelectedGroups} disabled={selectedGroupIds.size === 0} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"><Copy className="w-4 h-4"/>复制</button>
              <button type="button" onClick={handleDeleteSelectedGroups} disabled={selectedGroupIds.size === 0} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md text-red-600 bg-white border border-gray-300 dark:border-gray-500 dark:bg-gray-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"><XCircle className="w-4 h-4"/>删除</button>
            </div>
            <button type="submit" disabled={isFormInvalid || ruleGroups.filter(g => g.enabled && !isGroupContentInvalid(g)).length === 0} className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed">
              <Calculator className="-ml-1 mr-2 h-5 w-5" />
              应用已启用规则
            </button>
          </div>
        </div>
    );
  };


  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">规则配置</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">创建、分类和管理您的数据处理规则。</p>
            </div>
            <div className="text-right">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">规则总数</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{ruleGroups.length}</p>
            </div>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex-grow flex flex-col overflow-hidden">
        {renderActionBar('top')}
        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          {ruleGroups.length === 0 && (
            <div className="text-center py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
              <p className="text-gray-500 dark:text-gray-400">尚未创建任何规则。</p>
            </div>
          )}
          {ruleCategories.map(category => {
            const groupsInCategory = ruleGroups.filter(g => category.ruleGroupIds.includes(g.id));
            const invalidGroupsCount = groupsInCategory.filter(isGroupContentInvalid).length;
            const validGroups = groupsInCategory.filter(g => !isGroupContentInvalid(g));
            
            let categoryStatusClass = 'bg-gray-400';
            let categoryStatusTitle = '分类中所有规则已禁用';
      
            if (invalidGroupsCount > 0) {
              categoryStatusClass = 'bg-red-500';
              categoryStatusTitle = '分类中存在异常规则';
            } else if (validGroups.length > 0) {
              const enabledCount = validGroups.filter(g => g.enabled).length;
              const disabledCount = validGroups.length - enabledCount;
      
              if (enabledCount > 0 && disabledCount > 0) {
                categoryStatusClass = 'bg-orange-500';
                categoryStatusTitle = '分类中部分规则已启用';
              } else if (enabledCount > 0 && disabledCount === 0) {
                categoryStatusClass = 'bg-green-500';
                categoryStatusTitle = '分类中所有规则已启用';
              }
            } else if (groupsInCategory.length === 0) {
              categoryStatusTitle = '分类为空';
            }

            const groupsInCategoryIds = new Set(category.ruleGroupIds);
            const selectedGroupsInCatCount = Array.from(selectedGroupIds).filter(id => groupsInCategoryIds.has(id)).length;
            const allSelected = category.ruleGroupIds.length > 0 && selectedGroupsInCatCount === category.ruleGroupIds.length;
            const someSelected = selectedGroupsInCatCount > 0 && !allSelected;


            return (
              <div key={category.id} className="bg-gray-100 dark:bg-gray-900/70 border border-gray-300 dark:border-gray-700 rounded-lg shadow-md">
                <div className="flex items-center p-3">
                    <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected; }}
                        onChange={e => handleSelectAllInCategory(category.id, e.target.checked)}
                        disabled={category.ruleGroupIds.length === 0}
                        onClick={e => e.stopPropagation()}
                        className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-3 flex-shrink-0"
                    />
                    <div title={categoryStatusTitle} className={`w-3 h-3 rounded-full mr-3 flex-shrink-0 ${categoryStatusClass}`} />
                    <div className="flex items-center flex-grow cursor-pointer" onClick={() => handleUpdateCategory(category.id, 'isCollapsed', !category.isCollapsed)}>
                        <ChevronDown className={`w-5 h-5 mr-2 text-gray-400 transition-transform duration-200 ${!category.isCollapsed ? 'rotate-180' : ''}`} />
                        <Folder className="w-5 h-5 mr-2 text-yellow-500" />
                        {category.isCollapsed ? (
                            <span className="text-lg font-bold text-gray-800 dark:text-gray-200 flex-grow truncate" title={category.name}>
                                {category.name}
                            </span>
                        ) : (
                            <div className="flex-grow">
                            <input
                                type="text"
                                value={category.name}
                                onChange={e => handleUpdateCategory(category.id, 'name', e.target.value)}
                                onClick={e => e.stopPropagation()}
                                className={`text-lg font-bold text-gray-800 dark:text-gray-200 bg-transparent focus:outline-none focus:ring-0 border-0 border-b-2 w-full ${categoryNameError?.id === category.id ? 'border-red-500 focus:border-red-500' : 'border-transparent focus:border-blue-500'}`}
                            />
                             {categoryNameError?.id === category.id && (
                                <p className="text-xs text-red-500 mt-1">{categoryNameError.message}</p>
                            )}
                            </div>
                        )}
                        <span className="ml-3 text-sm font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
                            ({category.ruleGroupIds.length} 个规则)
                        </span>
                    </div>
                    <div className="flex items-center gap-4 ml-auto" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => handleCopyCategory(category.id)} title="复制分类" className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-400">
                          <Copy className="w-5 h-5" />
                      </button>
                      <button type="button" onClick={() => handleDeleteCategory(category.id)} className="text-red-500 hover:text-red-700 dark:hover:text-red-400"><Trash2 className="w-5 h-5" /></button>
                    </div>
                </div>
                {!category.isCollapsed && (
                  <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-700">
                    {ruleGroups
                      .filter(g => category.ruleGroupIds.includes(g.id))
                      .map(group => renderRuleGroup(group))
                    }
                     {category.ruleGroupIds.length === 0 && <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">此分类为空。</p>}
                     <div className="pt-2 flex justify-center">
                        <button
                          type="button"
                          onClick={() => addRuleGroupToCategory(category.id)}
                          className="inline-flex items-center px-3 py-1.5 border border-dashed border-gray-400 text-xs font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <PlusCircle className="w-4 h-4 mr-2" />
                          在此分类中添加新规则
                        </button>
                      </div>
                  </div>
                )}
              </div>
            )
          })}
          {topLevelRuleGroups.map(group => renderRuleGroup(group))}
        </div>
        {renderActionBar('bottom')}
      </form>
    </section>
  );
};

export default AllocationForm;