import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Paragraph from '@tiptap/extension-paragraph';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link as LinkIcon,
  Eraser,
  Paperclip,
  Table as TableIcon,
  Plus,
  Minus,
  Trash2,
  Columns,
  Rows,
  Heading,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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

// Note: Trailing spaces preservation is handled via keyboard handler and CSS
// Removed complex plugin to avoid potential runtime errors

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  titlePlaceholder?: string;
  readOnly?: boolean;
  onFileUpload?: (file: File) => Promise<void>;
  docId?: string;
  titleRightActions?: React.ReactNode;
}

export function RichTextEditor({ 
  content, 
  onChange, 
  placeholder = 'Start writing...',
  title,
  onTitleChange,
  titlePlaceholder = 'Untitled',
  readOnly = false,
  onFileUpload,
  docId,
  titleRightActions
}: RichTextEditorProps) {
  const initialContent = content || '<p></p>';
  const contentRef = useRef<string>(initialContent);
  const isUpdatingRef = useRef<boolean>(false);
  const editorInitializedRef = useRef<boolean>(false);
  const lastContentPropRef = useRef<string>(initialContent);
  const isUndoRedoRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isToolbarSticky, setIsToolbarSticky] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [toolbarStyle, setToolbarStyle] = useState<React.CSSProperties>({});
  const [hoveredTableSize, setHoveredTableSize] = useState<{ rows: number; cols: number } | null>(null);

  const baseToolbarClasses = 'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-75';
  const activeToolbarClasses = '!bg-primary !text-primary-foreground hover:!bg-primary/90 shadow-sm !transition-none';
  const getButtonClasses = (isActive: boolean) =>
    cn('rounded-md', isActive ? activeToolbarClasses : baseToolbarClasses);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        // Disable paragraph from StarterKit so we can configure our own
        paragraph: false,
      }),
      // Custom paragraph extension that preserves trailing spaces
      Paragraph.extend({
        parseHTML() {
          return [{ tag: 'p' }];
        },
        renderHTML({ HTMLAttributes }) {
          return ['p', { ...HTMLAttributes, style: 'white-space: pre-wrap;' }, 0];
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph', 'tableCell'],
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'table-wrapper',
        },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Color,
      TextStyle,
    ],
    content: initialContent,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      // Only call onChange if we're not in the middle of a programmatic update
      if (!isUpdatingRef.current) {
        const html = editor.getHTML();
        contentRef.current = html;
        
        if (isUndoRedoRef.current) {
          // During undo/redo, update lastContentPropRef to prevent useEffect from interfering
          // but still call onChange to keep parent state in sync
          lastContentPropRef.current = html;
          onChange(html);
          // Reset the flag after a short delay to allow undo/redo to complete
          setTimeout(() => {
            isUndoRedoRef.current = false;
          }, 0);
        } else {
          // Normal update - update refs and call onChange
          lastContentPropRef.current = html;
          onChange(html);
        }
      }
    },
    onCreate: ({ editor }) => {
      editorInitializedRef.current = true;
      const initialHtml = editor.getHTML();
      contentRef.current = initialHtml;
      // Initialize with the actual content prop, not the editor's initial HTML
      const normalizedContent = content || '<p></p>';
      lastContentPropRef.current = normalizedContent;
      // Always set content from prop if it's different (handles case where content loads after mount)
      if (normalizedContent !== initialHtml) {
        // Use setTimeout to ensure editor is fully ready
        setTimeout(() => {
          if (!editor.isDestroyed) {
            editor.commands.setContent(normalizedContent, false);
            contentRef.current = normalizedContent;
          }
        }, 0);
      }
    },
    editorProps: {
      attributes: {
        class: 'w-full focus:outline-none min-h-[300px] max-w-full overflow-x-hidden',
        style: 'white-space: pre-wrap !important; margin: 0; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; max-width: 100%; width: 100%; box-sizing: border-box;',
      },
      transformPastedHTML(html) {
        // Preserve formatting by returning the HTML as-is
        // TipTap will parse it and preserve supported formatting (bold, italic, colors, etc.)
        return html;
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          // Handle undo/redo keyboard shortcuts
          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
          const isUndo = (isMac && event.metaKey && event.key === 'z' && !event.shiftKey) ||
                        (!isMac && event.ctrlKey && event.key === 'z' && !event.shiftKey);
          const isRedo = (isMac && (event.metaKey && event.key === 'z' && event.shiftKey) || (event.metaKey && event.key === 'y')) ||
                        (!isMac && ((event.ctrlKey && event.key === 'y') || (event.ctrlKey && event.shiftKey && event.key === 'z')));
          
          if (isUndo || isRedo) {
            isUndoRedoRef.current = true;
            // Let TipTap handle the undo/redo, we just set the flag
            return false;
          }
          
          // Preserve trailing spaces when space is pressed at end of line
          if (event.key === ' ' || event.keyCode === 32) {
            const { state } = view;
            const { selection } = state;
            const { $from } = selection;
            
            // Check if cursor is at the end of the current block
            const parent = $from.parent;
            const isAtEnd = $from.parentOffset >= parent.content.size;
            
            if (isAtEnd) {
              // Insert a non-breaking space instead of regular space at end
              const tr = state.tr.insertText('\u00A0', $from.pos);
              view.dispatch(tr);
              event.preventDefault();
              return true; // Prevent default space insertion
            }
          }
          return false;
        },
      },
    },
  });

  // Update editor editability when readOnly changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Update editor content when the content prop changes
  // Only update when loading a new note, not during user editing
  useEffect(() => {
    if (!editor || !editorInitializedRef.current) {
      return;
    }

    // Skip updates during undo/redo operations to preserve history
    if (isUndoRedoRef.current) {
      return;
    }

    const normalizedContent = content || '<p></p>';
    
    // Skip if content prop hasn't changed from what we last processed
    if (normalizedContent === lastContentPropRef.current) {
      return;
    }

    // Get current editor content to compare
    const currentEditorContent = editor.getHTML();

    // If the editor content already matches the new content prop, 
    // this change came from user typing (onChange was called), so don't update
    // Updating would reset cursor position and cause it to jump
    if (currentEditorContent === normalizedContent || 
        currentEditorContent.trim() === normalizedContent.trim()) {
      // Just update the ref to prevent unnecessary updates
      lastContentPropRef.current = normalizedContent;
      contentRef.current = normalizedContent;
      return;
    }

    // Only update if content is significantly different (e.g., loading a new note from database)
    // This prevents cursor jumps during typing
    isUpdatingRef.current = true;
    lastContentPropRef.current = normalizedContent;

    try {
      // Save selection state before updating content
      const selection = editor.state.selection;
      const { from, to } = selection;
      
      // Use a timeout to ensure editor is ready and to batch updates
      const timeoutId = setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(normalizedContent, false);
          contentRef.current = normalizedContent;
          
          // Try to restore selection if still valid
          // This helps preserve cursor position when content updates
          try {
            const docSize = editor.state.doc.content.size;
            // Only restore if selection positions are still within document bounds
            if (from <= docSize && to <= docSize && from >= 0 && to >= 0) {
              editor.commands.setTextSelection({ from, to });
            }
          } catch {
            // Selection invalid (e.g., document structure changed significantly)
            // Editor will handle default cursor position
          }
        }
        isUpdatingRef.current = false;
      }, 100);

      return () => clearTimeout(timeoutId);
    } catch {
      isUpdatingRef.current = false;
    }
  }, [content, editor]);

  // Handle toolbar sticky positioning on scroll
  useEffect(() => {
    if (!toolbarRef.current || !toolbarContainerRef.current || readOnly) return;

    const updateStickyState = () => {
      const container = toolbarContainerRef.current;
      const toolbar = toolbarRef.current;
      if (!container) return;

      // Update toolbar height for spacer
      if (toolbar) {
        setToolbarHeight(toolbar.offsetHeight);
      }

      const rect = container.getBoundingClientRect();
      const headerHeight = 64; // Header is h-16 (64px)
      const toolbarTop = rect.top;
      const shouldBeSticky = toolbarTop <= headerHeight;
      
      // If toolbar would scroll past the header, make it sticky
      setIsToolbarSticky(shouldBeSticky);

      // Update toolbar style
      if (shouldBeSticky) {
        setToolbarStyle({
          position: 'fixed',
          top: '64px',
          left: `${rect.left}px`,
          width: `${rect.width}px`,
        });
      } else {
        setToolbarStyle({});
      }
    };

    // Use requestAnimationFrame for smoother performance
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateStickyState();
          ticking = false;
        });
        ticking = true;
      }
    };

    const onResize = () => {
      updateStickyState();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    updateStickyState(); // Check initial position

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [readOnly]);

  if (!editor) {
    return null;
  }

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    if (url === null) {
      return;
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="border border-border/30 rounded-lg w-full max-w-full bg-background shadow-sm">
      {/* Title Input */}
      {onTitleChange && (
        <div className="px-4 sm:px-6 pt-0 pb-3 overflow-x-hidden w-full max-w-full border-b border-border/20">
          <div className="flex items-center gap-2 w-full">
            <input
              type="text"
              placeholder={titlePlaceholder}
              value={title || ''}
              onChange={(e) => onTitleChange(e.target.value)}
              readOnly={readOnly}
              className={cn(
                "flex-1 min-w-0 text-2xl sm:text-3xl md:text-4xl font-semibold leading-tight border-none bg-transparent outline-none placeholder:text-muted-foreground/50 break-words focus:placeholder:text-muted-foreground/30 transition-colors",
                readOnly && "cursor-default"
              )}
            />
            {titleRightActions && (
              <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                {titleRightActions}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Toolbar Container - used to detect scroll position */}
      {!readOnly && (
        <div ref={toolbarContainerRef}>
          {/* Spacer to prevent layout shift when toolbar becomes fixed */}
          {isToolbarSticky && toolbarHeight > 0 && <div style={{ height: `${toolbarHeight}px` }} />}
          {/* Toolbar - Fixed position when scrolling past header */}
          <div 
            ref={toolbarRef}
            className={cn(
              "z-50 border-b border-border/20 bg-background/95 backdrop-blur-sm pl-3.5 pr-2.5 py-2.5 flex flex-wrap items-center gap-1 overflow-x-auto overflow-y-visible shadow-md transition-all",
              isToolbarSticky && "fixed"
            )}
            style={toolbarStyle}
          >
        {/* Text Formatting */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={getButtonClasses(editor.isActive('bold'))}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={getButtonClasses(editor.isActive('italic'))}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={getButtonClasses(editor.isActive('underline'))}
        >
          <UnderlineIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          className={getButtonClasses(editor.isActive('strike'))}
        >
          <Strikethrough className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            editor.chain().focus().unsetAllMarks().clearNodes().run();
          }}
          title="Clear all formatting"
        >
          <Eraser className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 opacity-30" />

        {/* Headings */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={getButtonClasses(
                editor.isActive('heading', { level: 1 }) ||
                editor.isActive('heading', { level: 2 }) ||
                editor.isActive('heading', { level: 3 })
              )}
              title="Headings"
            >
              <Heading className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            >
              <span className="font-bold text-lg">H1</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <span className="font-bold">H2</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              <span className="font-semibold text-sm">H3</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6 opacity-30" />

        {/* Lists */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={getButtonClasses(
                editor.isActive('bulletList') || editor.isActive('orderedList')
              )}
              title="Lists"
            >
              <List className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="h-4 w-4" />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="h-4 w-4" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={getButtonClasses(editor.isActive('blockquote'))}
        >
          <Quote className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 opacity-30" />

        {/* Table Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={getButtonClasses(editor.isActive('table'))}
              title="Table"
            >
              <TableIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <TableIcon className="h-4 w-4" />
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
                >
                  <ArrowUp className="h-4 w-4 mr-2" />
                  <span>Add row above</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().addRowAfter().run()}
                >
                  <ArrowDown className="h-4 w-4 mr-2" />
                  <span>Add row below</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().deleteRow().run()}
                  disabled={!editor.can().deleteRow()}
                >
                  <Minus className="h-4 w-4 mr-2" />
                  <span>Delete row</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().addColumnBefore().run()}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  <span>Add column on the left</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().addColumnAfter().run()}
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  <span>Add column on the right</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().deleteColumn().run()}
                  disabled={!editor.can().deleteColumn()}
                >
                  <Minus className="h-4 w-4 mr-2" />
                  <span>Delete column</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().deleteTable().run()}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  <span>Delete table</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6 opacity-30" />

        {/* Alignment */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={getButtonClasses(
                editor.isActive({ textAlign: 'left' }) ||
                editor.isActive({ textAlign: 'center' }) ||
                editor.isActive({ textAlign: 'right' })
              )}
              title="Text Alignment"
            >
              <AlignLeft className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
            >
              <AlignLeft className="h-4 w-4" />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
            >
              <AlignCenter className="h-4 w-4" />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
            >
              <AlignRight className="h-4 w-4" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6 opacity-30" />

        {/* Link */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={getButtonClasses(editor.isActive('link'))}
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[calc(100vw-2rem)] sm:w-80 max-w-sm">
            <div className="space-y-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                placeholder="https://example.com"
                defaultValue={editor.getAttributes('link').href || ''}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const url = e.currentTarget.value;
                    if (url) {
                      editor.chain().focus().setLink({ href: url }).run();
                    } else {
                      editor.chain().focus().unsetLink().run();
                    }
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const input = document.getElementById('link-url') as HTMLInputElement;
                  const url = input?.value;
                  if (url) {
                    editor.chain().focus().setLink({ href: url }).run();
                  } else {
                    editor.chain().focus().unsetLink().run();
                  }
                }}
              >
                Set Link
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="h-6 opacity-30" />

        {/* File Upload */}
        {onFileUpload && docId && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                // Validate file size (10MB max)
                if (file.size > 10 * 1024 * 1024) {
                  alert('File size exceeds 10MB limit');
                  return;
                }

                setIsUploading(true);
                try {
                  await onFileUpload(file);
                } catch (error) {
                  console.error('File upload error:', error);
                  alert(error instanceof Error ? error.message : 'Failed to upload file');
                } finally {
                  setIsUploading(false);
                  // Reset input
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              title="Upload file (max 10MB)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </>
        )}

        <Separator orientation="vertical" className="h-6 opacity-30" />

        {/* Undo/Redo */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            isUndoRedoRef.current = true;
            editor.chain().focus().undo().run();
          }}
          disabled={!editor.can().chain().focus().undo().run()}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            isUndoRedoRef.current = true;
            editor.chain().focus().redo().run();
          }}
          disabled={!editor.can().chain().focus().redo().run()}
        >
          <Redo className="h-4 w-4" />
        </Button>
          </div>
        </div>
      )}

      {/* Editor Content */}
      <EditorContent 
        editor={editor} 
        className="min-h-[500px] overflow-x-hidden px-4 sm:px-6 py-6 w-full max-w-full [&_.ProseMirror]:prose [&_.ProseMirror]:prose-base [&_.ProseMirror]:sm:prose-lg [&_.ProseMirror]:max-w-full [&_.ProseMirror]:w-full [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:p-0 [&_.ProseMirror]:mx-0 [&_.ProseMirror]:min-h-[460px] [&_.ProseMirror]:box-border [&_.ProseMirror_p]:my-0 [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:break-words [&_.ProseMirror_p]:overflow-wrap-anywhere [&_.ProseMirror]:break-words [&_.ProseMirror]:overflow-wrap-anywhere [&_.ProseMirror_pre]:max-w-full [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_code]:break-words [&_.ProseMirror_code]:max-w-full [&_.ProseMirror_code]:overflow-wrap-anywhere [&_.ProseMirror_a]:break-words [&_.ProseMirror_a]:overflow-wrap-anywhere [&_.ProseMirror_ul]:max-w-full [&_.ProseMirror_ol]:max-w-full [&_.ProseMirror_li]:break-words [&_.ProseMirror_li]:overflow-wrap-anywhere [&_.ProseMirror_.table-wrapper]:overflow-x-auto [&_.ProseMirror_.table-wrapper]:my-4 [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border [&_.ProseMirror_table]:border-border [&_.ProseMirror_table]:rounded-md [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:bg-muted/50 [&_.ProseMirror_th]:px-3 [&_.ProseMirror_th]:py-2 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:px-3 [&_.ProseMirror_td]:py-2 [&_.ProseMirror_td]:min-w-[100px] [&_.ProseMirror_td]:break-words [&_.ProseMirror_td]:overflow-wrap-anywhere [&_.ProseMirror_tr:hover_td]:bg-muted/30 [&_.ProseMirror_tr:hover_th]:bg-muted/60" 
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      />
    </div>
  );
}

