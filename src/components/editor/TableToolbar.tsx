import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table as TableIcon,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Minus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TableToolbarProps {
  editor: Editor;
  getButtonClasses: (isActive: boolean) => string;
}

export function TableToolbar({ editor, getButtonClasses }: TableToolbarProps) {
  const [hoveredTableSize, setHoveredTableSize] = useState<{ rows: number; cols: number } | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={getButtonClasses(editor.isActive('table'))}
          title="Table"
          aria-label="Table operations"
        >
          <TableIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label="Insert table">
            <TableIcon className="h-4 w-4" aria-hidden="true" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto p-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Select table size</Label>
              <div className="grid grid-cols-8 gap-1">
                {Array.from({ length: 64 }).map((_, index) => {
                  const row = Math.floor(index / 8) + 1;
                  const col = (index % 8) + 1;
                  const isSelected = hoveredTableSize
                    ? row <= hoveredTableSize.rows && col <= hoveredTableSize.cols
                    : false;
                  
                  return (
                    <button
                      key={index}
                      type="button"
                      className={cn(
                        "w-6 h-6 border border-border rounded-sm transition-colors",
                        isSelected
                          ? "bg-primary border-primary"
                          : "bg-muted hover:bg-muted/80"
                      )}
                      onMouseEnter={() => setHoveredTableSize({ rows: row, cols: col })}
                      onClick={() => {
                        editor
                          .chain()
                          .focus()
                          .insertTable({ rows: row, cols: col, withHeaderRow: true })
                          .run();
                        setHoveredTableSize(null);
                      }}
                      aria-label={`${row} rows, ${col} columns`}
                    />
                  );
                })}
              </div>
              {hoveredTableSize && (
                <p className="text-xs text-center text-muted-foreground">
                  {hoveredTableSize.rows} × {hoveredTableSize.cols}
                </p>
              )}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {editor.isActive('table') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Rows</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addRowBefore().run()}
              aria-label="Add row above current row"
            >
              <ArrowUp className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>Add row above</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addRowAfter().run()}
              aria-label="Add row below current row"
            >
              <ArrowDown className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>Add row below</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteRow().run()}
              disabled={!editor.can().deleteRow()}
              aria-label="Delete current row"
            >
              <Minus className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>Delete row</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addColumnBefore().run()}
              aria-label="Add column to the left of current column"
            >
              <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>Add column on the left</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              aria-label="Add column to the right of current column"
            >
              <ArrowRight className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>Add column on the right</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteColumn().run()}
              disabled={!editor.can().deleteColumn()}
              aria-label="Delete current column"
            >
              <Minus className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>Delete column</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="text-destructive focus:text-destructive"
              aria-label="Delete entire table"
            >
              <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>Delete table</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

