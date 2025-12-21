import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Paragraph from '@tiptap/extension-paragraph';
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
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

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
  docId
}: RichTextEditorProps) {
  const initialContent = content || '<p></p>';
  const contentRef = useRef<string>(initialContent);
  const isUpdatingRef = useRef<boolean>(false);
  const editorInitializedRef = useRef<boolean>(false);
  const lastContentPropRef = useRef<string>(initialContent);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const baseToolbarClasses = 'text-muted-foreground';
  const activeToolbarClasses = 'bg-primary text-primary-foreground hover:bg-primary/90';
  const getButtonClasses = (isActive: boolean) =>
    cn('transition-colors', baseToolbarClasses, isActive && activeToolbarClasses);

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
        types: ['heading', 'paragraph'],
      }),
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
        // Update lastContentPropRef to match what the user just typed
        // This prevents the useEffect from triggering an update when content prop changes
        lastContentPropRef.current = html;
        onChange(html);
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
      // Use a timeout to ensure editor is ready and to batch updates
      const timeoutId = setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(normalizedContent, false);
          contentRef.current = normalizedContent;
        }
        isUpdatingRef.current = false;
      }, 100);

      return () => clearTimeout(timeoutId);
    } catch {
      isUpdatingRef.current = false;
    }
  }, [content, editor]);

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
    <div className="border rounded-lg overflow-hidden w-full max-w-full">
      {/* Title Input */}
      {onTitleChange && (
        <div className="px-3 sm:px-5 pt-4 pb-2 overflow-x-hidden w-full max-w-full">
          <input
            type="text"
            placeholder={titlePlaceholder}
            value={title || ''}
            onChange={(e) => onTitleChange(e.target.value)}
            readOnly={readOnly}
            className={cn(
              "w-full text-2xl sm:text-3xl md:text-4xl font-semibold leading-snug border-none bg-transparent outline-none placeholder:text-muted-foreground/50 break-words",
              readOnly && "cursor-default"
            )}
          />
        </div>
      )}
      {/* Toolbar */}
      {!readOnly && (
      <div className="border-y p-2 flex flex-wrap items-center gap-1 overflow-x-auto">
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

        <Separator orientation="vertical" className="h-6" />

        {/* Headings */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={getButtonClasses(editor.isActive('heading', { level: 1 }))}
        >
          H1
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={getButtonClasses(editor.isActive('heading', { level: 2 }))}
        >
          H2
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={getButtonClasses(editor.isActive('heading', { level: 3 }))}
        >
          H3
        </Button>

        <Separator orientation="vertical" className="h-6" />

        {/* Lists */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={getButtonClasses(editor.isActive('bulletList'))}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={getButtonClasses(editor.isActive('orderedList'))}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={getButtonClasses(editor.isActive('blockquote'))}
        >
          <Quote className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6" />

        {/* Alignment */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={getButtonClasses(editor.isActive({ textAlign: 'left' }))}
        >
          <AlignLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={getButtonClasses(editor.isActive({ textAlign: 'center' }))}
        >
          <AlignCenter className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={getButtonClasses(editor.isActive({ textAlign: 'right' }))}
        >
          <AlignRight className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6" />

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

        <Separator orientation="vertical" className="h-6" />

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

        <Separator orientation="vertical" className="h-6" />

        {/* Undo/Redo */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>
      )}

      {/* Editor Content */}
      <EditorContent 
        editor={editor} 
        className="min-h-[500px] overflow-y-auto overflow-x-hidden px-3 sm:px-5 py-4 w-full max-w-full [&_.ProseMirror]:prose [&_.ProseMirror]:prose-base [&_.ProseMirror]:sm:prose-lg [&_.ProseMirror]:max-w-full [&_.ProseMirror]:w-full [&_.ProseMirror]:leading-snug [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:p-0 [&_.ProseMirror]:mx-0 [&_.ProseMirror]:min-h-[460px] [&_.ProseMirror]:box-border [&_.ProseMirror_p]:my-0 [&_.ProseMirror_p]:leading-snug [&_.ProseMirror_p]:break-words [&_.ProseMirror_p]:overflow-wrap-anywhere [&_.ProseMirror]:break-words [&_.ProseMirror]:overflow-wrap-anywhere [&_.ProseMirror_pre]:max-w-full [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_code]:break-words [&_.ProseMirror_code]:max-w-full [&_.ProseMirror_code]:overflow-wrap-anywhere [&_.ProseMirror_a]:break-words [&_.ProseMirror_a]:overflow-wrap-anywhere [&_.ProseMirror_ul]:max-w-full [&_.ProseMirror_ol]:max-w-full [&_.ProseMirror_li]:break-words [&_.ProseMirror_li]:overflow-wrap-anywhere" 
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      />
    </div>
  );
}

