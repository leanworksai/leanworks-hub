import type { FilterType, FilterConfig } from '@/hooks/useTableFilterSort';

/**
 * Extract text content from a table cell element
 */
export function getCellText(cell: HTMLElement): string {
  return cell.textContent?.trim() || '';
}

/**
 * Detect if a value is numeric
 */
export function isNumeric(value: string): boolean {
  if (value === '') return false;
  return !isNaN(Number(value));
}

/**
 * Parse a value to number if possible
 */
export function parseValue(value: string): string | number {
  if (isNumeric(value)) {
    return Number(value);
  }
  return value;
}

/**
 * Compare two values based on filter type
 */
export function matchesFilter(cellValue: string, filter: FilterConfig): boolean {
  const { type, value } = filter;
  
  if (!value) return true; // Empty filter matches everything
  
  const cellText = cellValue.toLowerCase();
  const filterText = value.toLowerCase();
  
  switch (type) {
    case 'equals':
      return cellText === filterText;
    
    case 'notEquals':
      return cellText !== filterText;
    
    case 'contains':
      return cellText.includes(filterText);
    
    case 'gt':
      if (isNumeric(cellValue) && isNumeric(value)) {
        return Number(cellValue) > Number(value);
      }
      return cellText > filterText;
    
    case 'lt':
      if (isNumeric(cellValue) && isNumeric(value)) {
        return Number(cellValue) < Number(value);
      }
      return cellText < filterText;
    
    default:
      return true;
  }
}

/**
 * Compare two values for sorting
 */
export function compareValues(a: string, b: string, sortType: 'asc' | 'desc'): number {
  const parsedA = parseValue(a);
  const parsedB = parseValue(b);
  
  let comparison = 0;
  
  if (typeof parsedA === 'number' && typeof parsedB === 'number') {
    comparison = parsedA - parsedB;
  } else {
    const strA = String(parsedA).toLowerCase();
    const strB = String(parsedB).toLowerCase();
    comparison = strA.localeCompare(strB);
  }
  
  return sortType === 'asc' ? comparison : -comparison;
}

/**
 * Get all data rows from a table (excluding header row)
 */
export function getTableDataRows(table: HTMLElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  const allRows = table.querySelectorAll('tr');
  
  // Skip first row (header row)
  for (let i = 1; i < allRows.length; i++) {
    rows.push(allRows[i] as HTMLTableRowElement);
  }
  
  return rows;
}

/**
 * Get cell value at specific column index from a row
 */
export function getCellValueAtIndex(row: HTMLTableRowElement, columnIndex: number): string {
  const cells = row.querySelectorAll('td, th');
  const cell = cells[columnIndex];
  return cell ? getCellText(cell as HTMLElement) : '';
}

/**
 * Apply filter to determine which rows should be visible
 */
export function getFilteredRowIndices(
  rows: HTMLTableRowElement[],
  filters: Map<number, FilterConfig>
): Set<number> {
  const visibleIndices = new Set<number>();
  
  rows.forEach((row, rowIndex) => {
    let matches = true;
    
    // Check all active filters
    for (const [columnIndex, filter] of filters.entries()) {
      const cellValue = getCellValueAtIndex(row, columnIndex);
      if (!matchesFilter(cellValue, filter)) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      visibleIndices.add(rowIndex);
    }
  });
  
  return visibleIndices;
}

/**
 * Sort rows based on column and sort type
 */
export function getSortedRowIndices(
  rows: HTMLTableRowElement[],
  columnIndex: number,
  sortType: 'asc' | 'desc',
  visibleIndices?: Set<number>
): number[] {
  // Create array of [rowIndex, cellValue] pairs
  const indexedRows = rows.map((row, index) => ({
    index,
    value: getCellValueAtIndex(row, columnIndex),
    isVisible: visibleIndices ? visibleIndices.has(index) : true,
  }));
  
  // Sort only visible rows
  const visibleRows = indexedRows.filter(r => r.isVisible);
  const hiddenRows = indexedRows.filter(r => !r.isVisible);
  
  visibleRows.sort((a, b) => compareValues(a.value, b.value, sortType));
  
  // Return sorted indices: visible rows first (sorted), then hidden rows
  return [
    ...visibleRows.map(r => r.index),
    ...hiddenRows.map(r => r.index),
  ];
}

/**
 * Apply visual transformations to table rows
 */
export function applyTableTransforms(
  table: HTMLElement,
  filters: Map<number, FilterConfig>,
  sorts: Map<number, 'asc' | 'desc'>
): void {
  const rows = getTableDataRows(table);
  
  if (rows.length === 0) return;
  
  // First, apply filters
  const visibleIndices = filters.size > 0 
    ? getFilteredRowIndices(rows, filters)
    : new Set(rows.map((_, i) => i));
  
  // Apply filter classes
  rows.forEach((row, index) => {
    if (visibleIndices.has(index)) {
      row.classList.remove('table-row-filtered');
      row.style.display = '';
    } else {
      row.classList.add('table-row-filtered');
      row.style.display = 'none';
    }
  });
  
  // Then, apply sorting if any
  if (sorts.size > 0) {
    // Apply the first sort (for simplicity, single column sort)
    const [columnIndex, sortType] = Array.from(sorts.entries())[0];
    const sortedIndices = getSortedRowIndices(rows, columnIndex, sortType, visibleIndices);
    
    // Reorder rows in DOM by moving existing elements
    const parent = rows[0].parentElement;
    if (parent) {
      // Create a document fragment and move rows in sorted order
      const fragment = document.createDocumentFragment();
      sortedIndices.forEach((originalIndex) => {
        // Move the actual row (not clone) to maintain event listeners
        fragment.appendChild(rows[originalIndex]);
      });
      
      // Append all sorted rows back to parent
      parent.appendChild(fragment);
    }
  }
}

/**
 * Reset all visual transformations on a table
 */
export function resetTableTransforms(table: HTMLElement): void {
  const rows = getTableDataRows(table);
  rows.forEach((row) => {
    row.classList.remove('table-row-filtered');
    row.style.display = '';
  });
}

