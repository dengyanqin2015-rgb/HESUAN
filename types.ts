
export type TableRow = Record<string, string | number | boolean | null>;

export type TableData = TableRow[];

export interface Table {
  id: string;
  name: string;
  data: TableData;
  headers: string[];
  originalData: TableData;
}

export type FilterOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'is_empty' | 'is_not_empty';

export interface FilterCondition {
  id: string; // Unique ID for React key
  column: string;
  operator: FilterOperator;
  value: string;
  logic?: 'and' | 'or'; // Logic operator connecting THIS condition to the PREVIOUS one
}

export type ActionType = 'distribute_amount' | 'fill_text' | 'ai_formula' | 'lookup_value' | 'count_duplicates' | 'multi_match' | 'inclusion_match' | 'cross_column_calculation';

export interface CellValueSource {
    tableId: string;
    column: string;
    filters: FilterCondition[];
}

export type MatchOperator = 'equals' | 'contains';

export interface LookupMatchCondition {
    id: string;
    mainColumn: string;
    operator: MatchOperator;
    sourceType: 'column' | 'static';
    sourceValue: string;
    logic?: 'and' | 'or';
}

export interface LookupValueConfig {
    sourceTableId: string;
    matches: LookupMatchCondition[];
    sourceValueType: 'column' | 'static';
    sourceValueColumn: string;
}

export interface CountDuplicatesConfig {
    sourceColumn: string;
}

export interface MultiMatchRule {
  id: string;
  conditions: FilterCondition[];
  sourceColumn: string;
}

export interface MultiMatchConfig {
  rules: MultiMatchRule[];
}

export interface InclusionMatchConfig {
    sourceTableId: string;
    mainSearchColumn: string;
    sourceMatchColumn: string;
    sourceValueColumn: string;
    matchDirection?: 'main_contains_source' | 'source_contains_main';
}

export interface CrossColumnCalculationPart {
  id: string;
  columnName: string;
  operator?: '+' | '-' | '*' | '/';
  openBrackets?: number;
  closeBrackets?: number;
}

export interface CrossColumnCalculationConfig {
  parts: CrossColumnCalculationPart[];
}


export interface AllocationAction {
  type: ActionType;
  newColumnName: string;
  // For distribute_amount
  sourceType?: 'manual' | 'cell';
  totalAmount?: number;
  cellSource?: CellValueSource;
  // for fill_text
  fillText?: string;
  // for ai_formula
  aiPrompt?: string;
  // for lookup_value
  lookupConfig?: LookupValueConfig;
  // for count_duplicates
  countDuplicatesConfig?: CountDuplicatesConfig;
  // for multi_match
  multiMatchConfig?: MultiMatchConfig;
  // for inclusion_match
  inclusionMatchConfig?: InclusionMatchConfig;
  // for cross_column_calculation
  crossColumnCalculationConfig?: CrossColumnCalculationConfig;
}

export interface RuleGroup {
    id: string;
    name: string;
    enabled: boolean;
    isCollapsed: boolean;
    filters: FilterCondition[];
    action: AllocationAction;
    validationError?: string | null;
}

export interface RuleCategory {
    id:string;
    name: string;
    isCollapsed: boolean;
    ruleGroupIds: string[];
}

export type AllocationConfig = RuleGroup[];