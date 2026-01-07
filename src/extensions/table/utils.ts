import type { EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import { TextSelection } from 'prosemirror-state';
import type { TableCellSelectionResult, TablePosition, TableCellSelectionConfig } from './types';

/**
 * Safely execute a table operation with error handling
 */
export function safeTableOperation<T>(
  operation: () => T,
  fallback: T,
  context: string
): T {
  try {
    return operation();
  } catch (error) {
    console.error(`Table operation failed [${context}]:`, error);
    return fallback;
  }
}

/**
 * Find table cell node from a DOM element
 * Returns the position information if found
 */
export function findTableCell(
  view: EditorView,
  element: HTMLElement
): TablePosition | null {
  return safeTableOperation(
    () => {
      const pos = view.posAtDOM(element, 0);
      
      if (pos === null || pos < 0) {
        return null;
      }

      const { state } = view;
      const $pos = state.doc.resolve(pos);
      
      // Walk up the node tree to find the table cell
      for (let depth = $pos.depth; depth > 0; depth--) {
        const node = $pos.node(depth);
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          const cellStartPos = $pos.start(depth);
          const cellEndPos = $pos.end(depth);
          
          // Content positions: start is right after cell opening, end is before closing
          const contentStartPos = cellStartPos + 1;
          const contentEndPos = cellEndPos - 1;
          
          return {
            cellDepth: depth,
            cellStartPos,
            cellEndPos,
            contentStartPos,
            contentEndPos,
          };
        }
      }
      
      return null;
    },
    null,
    'findTableCell'
  );
}

/**
 * Validate that a position is within document bounds
 */
export function validateCellPosition(
  state: EditorState,
  pos: number
): boolean {
  return pos >= 0 && pos <= state.doc.content.size;
}

/**
 * Select all content within a table cell
 * Uses $pos.start/end which properly account for nested node boundaries
 */
export function selectCellContent(
  view: EditorView,
  cellElement: HTMLElement,
  config: TableCellSelectionConfig = {}
): TableCellSelectionResult {
  const { focusEditor = true, preventDefault = true } = config;
  
  return safeTableOperation(
    () => {
      const position = findTableCell(view, cellElement);
      
      if (!position) {
        return {
          success: false,
          error: 'Could not find table cell position',
        };
      }

      const { state } = view;
      const { contentStartPos, contentEndPos } = position;
      
      // Validate positions
      if (!validateCellPosition(state, contentStartPos) || 
          !validateCellPosition(state, contentEndPos)) {
        return {
          success: false,
          error: 'Invalid cell position',
        };
      }

      // If cell is empty, just place cursor
      if (contentStartPos >= contentEndPos) {
        const $cursor = state.doc.resolve(contentStartPos);
        view.dispatch(
          state.tr.setSelection(new TextSelection($cursor))
        );
        
        if (focusEditor) {
          view.focus();
        }
        
        return {
          success: true,
          from: contentStartPos,
          to: contentStartPos,
        };
      }

      // Create selection covering all content in the cell
      const $start = state.doc.resolve(contentStartPos);
      const $end = state.doc.resolve(contentEndPos);
      
      if ($start.pos >= $end.pos) {
        return {
          success: false,
          error: 'Invalid selection range',
        };
      }

      view.dispatch(
        state.tr.setSelection(new TextSelection($start, $end))
      );
      
      if (focusEditor) {
        view.focus();
      }
      
      return {
        success: true,
        from: $start.pos,
        to: $end.pos,
      };
    },
    {
      success: false,
      error: 'Unknown error during cell selection',
    },
    'selectCellContent'
  );
}

/**
 * Handle double-click event on table cells
 * Returns true if the event was handled, false otherwise
 */
export function handleTableDblClick(
  view: EditorView,
  event: MouseEvent
): boolean {
  const target = event.target as HTMLElement;
  
  // Find table cell element (td or th)
  let cellElement: HTMLElement | null = target;
  while (cellElement && cellElement.tagName !== 'TD' && cellElement.tagName !== 'TH') {
    cellElement = cellElement.parentElement;
    // Prevent infinite loop
    if (cellElement === view.dom) {
      break;
    }
  }
  
  if (!cellElement || (cellElement.tagName !== 'TD' && cellElement.tagName !== 'TH')) {
    return false;
  }
  
  // Select cell content
  const result = selectCellContent(view, cellElement, {
    focusEditor: true,
    preventDefault: true,
  });
  
  if (result.success) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  
  // Log error but don't prevent default behavior
  if (result.error) {
    console.warn('Failed to select table cell content:', result.error);
  }
  
  return false;
}

