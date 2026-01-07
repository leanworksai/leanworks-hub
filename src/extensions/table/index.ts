/**
 * Table Extensions Module
 * 
 * Provides TipTap table extensions with best practices:
 * - Proper accessibility attributes (ARIA roles)
 * - Enhanced configuration options
 * - Utility functions for table operations
 * - Error handling and validation
 */

// Export extensions
export {
  ConfiguredTable,
  ConfiguredTableRow,
  CustomTableCell,
  CustomTableHeader,
  ConfiguredGapcursor,
} from './extensions';

// Export utility functions
export {
  findTableCell,
  selectCellContent,
  validateCellPosition,
  handleTableDblClick,
  safeTableOperation,
} from './utils';

// Export types
export type {
  TableCellSelectionResult,
  TablePosition,
  TableCellSelectionConfig,
  TableColumnConfig,
  TableConfig,
} from './types';

/**
 * Array of all table-related extensions ready to use
 */
import {
  ConfiguredTable,
  ConfiguredTableRow,
  CustomTableCell,
  CustomTableHeader,
  ConfiguredGapcursor,
} from './extensions';

export const tableExtensions = [
  ConfiguredTable,
  ConfiguredTableRow,
  CustomTableCell,
  CustomTableHeader,
  ConfiguredGapcursor,
];

