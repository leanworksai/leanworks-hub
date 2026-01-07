import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Gapcursor } from '@tiptap/extension-gapcursor';

/**
 * Configured Table extension with best practices
 */
export const ConfiguredTable = Table.configure({
  resizable: true,
  handleWidth: 5,
  cellMinWidth: 100,
  lastColumnResizable: true,
  allowTableNodeSelection: false,
  HTMLAttributes: {
    class: 'prose-table',
    role: 'table',
    'aria-label': 'Data table',
  },
});

/**
 * Configured TableRow extension with accessibility
 */
export const ConfiguredTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      role: {
        default: 'row',
        parseHTML: () => 'row',
        renderHTML: () => ({ role: 'row' }),
      },
    };
  },
});

/**
 * Custom TableCell extension with accessibility attributes
 */
export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      role: {
        default: 'cell',
        parseHTML: () => 'cell',
        renderHTML: () => ({ role: 'cell' }),
      },
    };
  },
  
  renderHTML({ HTMLAttributes }) {
    return [
      'td',
      {
        ...HTMLAttributes,
        role: 'cell',
      },
      0,
    ];
  },
});

/**
 * Custom TableHeader extension with accessibility attributes
 */
export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      role: {
        default: 'columnheader',
        parseHTML: () => 'columnheader',
        renderHTML: () => ({ role: 'columnheader' }),
      },
      scope: {
        default: 'col',
        parseHTML: () => 'col',
        renderHTML: () => ({ scope: 'col' }),
      },
    };
  },
  
  renderHTML({ HTMLAttributes }) {
    return [
      'th',
      {
        ...HTMLAttributes,
        role: 'columnheader',
        scope: 'col',
      },
      0,
    ];
  },
});

/**
 * Gapcursor extension for proper cursor navigation around tables
 */
export const ConfiguredGapcursor = Gapcursor;

