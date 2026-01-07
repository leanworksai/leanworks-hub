import type { EditorState } from '@tiptap/pm/state';

/**
 * Result of attempting to select cell content
 */
export interface TableCellSelectionResult {
  success: boolean;
  error?: string;
  from?: number;
  to?: number;
}

/**
 * Position information for a table cell in the document
 */
export interface TablePosition {
  cellDepth: number;
  cellStartPos: number;
  cellEndPos: number;
  contentStartPos: number;
  contentEndPos: number;
}

/**
 * Configuration for table cell selection behavior
 */
export interface TableCellSelectionConfig {
  /**
   * Whether to focus the editor after selection
   * @default true
   */
  focusEditor?: boolean;
  
  /**
   * Whether to prevent default browser behavior
   * @default true
   */
  preventDefault?: boolean;
}

/**
 * Shared types for filter/sort integration (if needed)
 */
export interface TableColumnConfig {
  filter?: {
    type: 'equals' | 'notEquals' | 'contains' | 'gt' | 'lt';
    value: string;
  };
  sort?: 'asc' | 'desc' | null;
}

export interface TableConfig {
  [columnIndex: string]: TableColumnConfig;
}

