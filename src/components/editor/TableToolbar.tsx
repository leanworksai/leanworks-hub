import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table as TableIcon,
  PlusCircle,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TableToolbarProps {
  editor: Editor;
  getButtonClasses: (isActive: boolean) => string;
}

export function TableToolbar({ editor, getButtonClasses }: TableToolbarProps) {
  const [hoveredTableSize, setHoveredTableSize] = useState<{ rows: number; cols: number } | null>(null);
  const isInTable = editor.isActive('table');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={getButtonClasses(isInTable)}
          title="Table Operations"
          aria-label="Table operations"
        >
          <TableIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="p-3 min-w-[180px]">
        {/* Table Size Grid - Shown when not in a table */}
        {!isInTable && (
          <div className="flex flex-col items-center">
            <div className="w-full text-left mb-3">
              <h4 className="text-sm font-semibold text-foreground">Insert Table</h4>
              <p className="text-[11px] text-muted-foreground">Select grid size</p>
            </div>
            
            <div 
              className="grid grid-cols-6 gap-1.5 p-1 border rounded-md bg-muted/20"
              onMouseLeave={() => setHoveredTableSize(null)}
            >
              {Array.from({ length: 36 }).map((_, index) => {
                const row = Math.floor(index / 6) + 1;
                const col = (index % 6) + 1;
                const isSelected = hoveredTableSize
                  ? row <= hoveredTableSize.rows && col <= hoveredTableSize.cols
                  : false;
                
                return (
                  <button
                    key={index}
                    type="button"
                    className={cn(
                      "w-5 h-5 border rounded-sm transition-all duration-100",
                      isSelected
                        ? "bg-primary border-primary shadow-sm scale-110 z-10"
                        : "bg-background border-border hover:border-primary/50"
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
            <div className="mt-3 w-full bg-muted/30 rounded py-1 px-2 text-center">
              <span className="text-xs font-mono text-primary font-medium">
                {hoveredTableSize ? `${hoveredTableSize.rows} × ${hoveredTableSize.cols}` : '— × —'}
              </span>
            </div>
          </div>
        )}

        {/* Table Operations - Shown when cursor is in a table */}
        {isInTable && (
          <div className="space-y-3">
            <div className="w-full text-left">
              <h4 className="text-sm font-semibold text-foreground">Table Actions</h4>
              <p className="text-[11px] text-muted-foreground">Manage rows & columns</p>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-2 mb-1">Rows</p>
              <DropdownMenuItem
                onClick={() => editor.chain().focus().addRowBefore().run()}
                className="cursor-pointer"
              >
                <ArrowUpToLine className="h-3.5 w-3.5 mr-2 text-primary" />
                <span className="text-xs">Add row above</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => editor.chain().focus().addRowAfter().run()}
                className="cursor-pointer"
              >
                <ArrowDownToLine className="h-3.5 w-3.5 mr-2 text-primary" />
                <span className="text-xs">Add row below</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => editor.chain().focus().deleteRow().run()}
                disabled={!editor.can().deleteRow()}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <XCircle className="h-3.5 w-3.5 mr-2" />
                <span className="text-xs">Delete row</span>
              </DropdownMenuItem>
            </div>

            <DropdownMenuSeparator />

            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-2 mb-1">Columns</p>
              <DropdownMenuItem
                onClick={() => editor.chain().focus().addColumnBefore().run()}
                className="cursor-pointer"
              >
                <ArrowLeftToLine className="h-3.5 w-3.5 mr-2 text-primary" />
                <span className="text-xs">Add column left</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                className="cursor-pointer"
              >
                <ArrowRightToLine className="h-3.5 w-3.5 mr-2 text-primary" />
                <span className="text-xs">Add column right</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => editor.chain().focus().deleteColumn().run()}
                disabled={!editor.can().deleteColumn()}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <XCircle className="h-3.5 w-3.5 mr-2" />
                <span className="text-xs">Delete column</span>
              </DropdownMenuItem>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10 font-medium"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              <span className="text-xs">Remove entire table</span>
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
