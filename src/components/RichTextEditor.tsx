import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Paragraph from '@tiptap/extension-paragraph';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { tableExtensions, handleTableDblClick } from '@/extensions/table';
import '@/extensions/table/styles.css';
import '@/components/code-highlight.css';
import { TableToolbar } from '@/components/editor/TableToolbar';
import { useEffect, useRef, useState, useCallback } from 'react';
import { marked } from 'marked';
import mermaid from 'mermaid';
import { useTextSelection } from '@/hooks/useTextSelection';
import { useSelectedTextContext } from '@/contexts/SelectedTextContext';
import { FloatingAskAI } from '@/components/FloatingAskAI';
import { 
  detectMarkdownConversionNeeded, 
  convertMarkdownToHtml,
  shouldConvertMarkdownPaste,
  shouldPreserveHtmlPaste 
} from '@/utils/markdownConverter';

// Create lowlight instance with common languages
const lowlight = createLowlight(common);
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
  AlignLeft,
  AlignCenter,
  AlignRight,
  Eraser,
  Paperclip,
  Heading,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
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

// Helper function to extract text from HTML while preserving line breaks
function extractTextPreservingLineBreaks(html: string): string {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // Replace block-level elements with newlines before extracting text
  const blockElements = tempDiv.querySelectorAll('p, div, br, h1, h2, h3, h4, h5, h6, li, tr');
  blockElements.forEach(el => {
    if (el.tagName === 'BR') {
      el.replaceWith('\n');
    } else {
      // Add newline after block elements
      el.insertAdjacentText('afterend', '\n');
    }
  });
  
  // Get text content - now with preserved line breaks
  let text = tempDiv.textContent || tempDiv.innerText || '';
  
  // Clean up excessive newlines but preserve paragraph breaks
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text;
}

// Helper function to detect if content is markdown
function isMarkdownContent(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  
  // Extract text if HTML, preserving line breaks for pattern matching
  let textContent = content;
  if (content.includes('<')) {
    textContent = extractTextPreservingLineBreaks(content);
  }
  
  // Check for markdown patterns - ordered by likelihood and distinctiveness
  const markdownPatterns = [
    /```[\s\S]*?```/,        // Code blocks (including ```mermaid, ```tsx, etc.) - most distinctive
    /^#{1,6}\s+\S/m,         // Headers (# followed by space and text)
    /^\s*[-*+]\s+\S/m,       // Unordered lists (- or * followed by space and text)
    /^\s*\d+\.\s+\S/m,       // Ordered lists (1. followed by space and text)
    /^>\s/m,                 // Blockquotes
    /\[([^\]]+)\]\(([^)]+)\)/, // Links [text](url)
    /\*\*[^*]+\*\*/,         // Bold **text**
    /\*[^*]+\*/,             // Italic *text*
    /~~[^~]+~~/,             // Strikethrough ~~text~~
    /`[^`\n]+`/,             // Inline code `code` (but not multiline)
    /^---$/m,                // Horizontal rule
    /^\|.*\|$/m,             // Table rows
  ];
  
  // Count how many patterns match - if multiple match, it's very likely markdown
  const matchCount = markdownPatterns.filter(pattern => pattern.test(textContent)).length;
  
  // If 2+ patterns match, definitely markdown
  // If 1 pattern matches and it's a distinctive one (code block or header), also markdown
  if (matchCount >= 2) return true;
  if (matchCount === 1) {
    // Check if it's a distinctive pattern
    if (/```[\s\S]*?```/.test(textContent)) return true;  // Code block
    if (/^#{1,6}\s+\S/m.test(textContent)) return true;   // Header
    if (/^\|.*\|$/m.test(textContent)) return true;       // Table
  }
  
  return false;
}

// Helper function to restore line breaks in markdown that was flattened to a single line
function restoreMarkdownLineBreaks(text: string): string {
  let result = text;
  
  // First, handle code blocks - they need careful treatment
  // Add newlines before and after code block markers
  // Match ```language and add newline before it
  result = result.replace(/([^\n`])(```[a-zA-Z]*)/g, '$1\n\n$2');
  // Match ``` (closing) followed by non-backtick and add newline after
  result = result.replace(/(```)\s*([^`\n\s])/g, '$1\n\n$2');
  
  // Add newlines before headers (# ## ### etc.)
  // Match any character (except newline) followed by # headers
  result = result.replace(/([^\n#])(#{1,6}\s+[A-Z])/g, '$1\n\n$2');
  
  // Add newlines before numbered list items (1. 2. 3. etc.)
  // Look for pattern like "text 1. Item" or "text1. Item"
  result = result.replace(/([.!?:;\n])\s*(\d+\.\s+[A-Z])/g, '$1\n$2');
  
  // Add newlines before bullet list items (- * +)
  // Look for pattern like "text - Item" where Item starts with capital
  result = result.replace(/([.!?:;\n])\s*([-*+]\s+[A-Z**])/g, '$1\n$2');
  
  // Add newlines before blockquotes
  result = result.replace(/([.!?:;\n])\s*(>\s+)/g, '$1\n$2');
  
  // Handle labels like "Query:", "Response:", "Note:" etc.
  result = result.replace(/([.!?\n])\s*((?:Query|Response|Question|Answer|Note|Warning|Example|Summary|Implementation|Best Practices?):)/gi, '$1\n\n$2');
  
  // Inside code blocks, try to restore newlines at logical points
  // This is tricky - we need to handle each code block separately
  result = result.replace(/(```[a-zA-Z]*)([\s\S]*?)(```)/g, (match, open, content, close) => {
    // Add newlines after opening and before closing
    let fixedContent = content;
    const language = open.replace('```', '').toLowerCase();
    
    // Add newline after opening if not present
    if (!fixedContent.startsWith('\n')) {
      fixedContent = '\n' + fixedContent;
    }
    
    // Add newline before closing if not present
    if (!fixedContent.endsWith('\n')) {
      fixedContent = fixedContent + '\n';
    }
    
    // Handle mermaid diagrams specifically
    if (language === 'mermaid') {
      // Add newlines for mermaid graph definitions
      fixedContent = fixedContent.replace(/\s+(graph\s+(?:LR|RL|TD|TB|BT))\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(flowchart\s+(?:LR|RL|TD|TB|BT))\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(sequenceDiagram)\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(classDiagram)\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(stateDiagram(?:-v2)?)\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(erDiagram)\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(gantt)\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(pie)\s+/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(journey)\s+/g, '\n$1\n');
      
      // Add newlines before node definitions (A[...], B(...), etc.)
      fixedContent = fixedContent.replace(/\s+([A-Za-z_][A-Za-z0-9_]*\s*[\[\(\{<])/g, '\n    $1');
      
      // Add newlines before arrows (--> , --- , ==> , etc.)
      fixedContent = fixedContent.replace(/\s+(-->|--\>|---|==>|-.->|==)/g, ' $1');
      
      // Add newlines after arrow destinations
      fixedContent = fixedContent.replace(/(-->|--\>|---|==>|-.->|==)\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*[\[\(\{<][^\]\)\}>]*[\]\)\}>])?)\s+/g, '$1 $2\n    ');
      
      // Add newlines for subgraph
      fixedContent = fixedContent.replace(/\s+(subgraph\s+)/g, '\n$1');
      fixedContent = fixedContent.replace(/\s+(end)\s+/g, '\n$1\n');
      
      // Clean up participant declarations in sequence diagrams
      fixedContent = fixedContent.replace(/\s+(participant\s+)/g, '\n$1');
      fixedContent = fixedContent.replace(/\s+(actor\s+)/g, '\n$1');
      
      // Handle class definitions in class diagrams
      fixedContent = fixedContent.replace(/\s+(class\s+[A-Za-z_][A-Za-z0-9_]*)/g, '\n$1');
    }
    // Handle PlantUML
    else if (language === 'plantuml' || language === 'puml') {
      fixedContent = fixedContent.replace(/\s+(@startuml|@enduml)/g, '\n$1\n');
      fixedContent = fixedContent.replace(/\s+(participant|actor|usecase|class|interface)\s+/g, '\n$1 ');
      fixedContent = fixedContent.replace(/\s+(-->|->|<--|<-|--)\s+/g, ' $1 ');
    }
    // Handle regular code (tsx, ts, js, jsx, etc.)
    else if (['tsx', 'ts', 'js', 'jsx', 'javascript', 'typescript'].includes(language)) {
      // After semicolons followed by keywords
      fixedContent = fixedContent.replace(/;\s*(const|let|var|function|class|interface|type|import|export|return|if|else|for|while|async|await)\s/g, ';\n$1 ');
      
      // After closing braces followed by keywords
      fixedContent = fixedContent.replace(/}\s*(const|let|var|function|class|interface|type|export|return|if|else|for|while|async|catch|finally)\s/g, '}\n\n$1 ');
      
      // After closing braces followed by closing braces or parens
      fixedContent = fixedContent.replace(/}\s*([)}])/g, '}\n$1');
      
      // Add newlines after import statements
      fixedContent = fixedContent.replace(/(import\s+[^;]+;)\s*/g, '$1\n');
      
      // Add newlines before export statements
      fixedContent = fixedContent.replace(/([;}\n])\s*(export\s+)/g, '$1\n\n$2');
    }
    // Handle Python
    else if (language === 'python' || language === 'py') {
      fixedContent = fixedContent.replace(/:\s*(def|class|if|elif|else|for|while|try|except|finally|with|import|from|return)\s/g, ':\n$1 ');
    }
    // Handle SQL
    else if (language === 'sql') {
      fixedContent = fixedContent.replace(/\s+(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|ORDER BY|GROUP BY|HAVING|LIMIT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+/gi, '\n$1 ');
    }
    
    return open + fixedContent + close;
  });
  
  // Clean up multiple newlines (max 2)
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();
  
  return result;
}


// Simplified markdown to HTML conversion (line break restoration removed)
// The problematic restoreMarkdownLineBreaks function was causing conversion issues
function convertMarkdownToHTML(markdown: string): string {
  try {
    // Convert markdown to HTML with line break support
    return marked.parse(markdown, {
      breaks: true,  // Convert single newlines to <br>
      gfm: true,     // GitHub Flavored Markdown
    }) as string;
  } catch (error) {
    console.warn('Failed to convert markdown:', error);
    return markdown; // Return original if conversion fails
  }
}

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  onFileUpload?: (file: File) => Promise<void>;
  docId?: string;
}

export function RichTextEditor({ 
  content, 
  onChange, 
  placeholder = 'Start writing...',
  readOnly = false,
  onFileUpload,
  docId,
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
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const { selectedText, hasSelection, selectionBounds, selectionPosition } = useTextSelection(
    editorContainerRef,
    editorRef, // Pass ref instead of editor instance
    docId
  );
  const { setSelectedTextPosition } = useSelectedTextContext();
  const [isUploading, setIsUploading] = useState(false);
  const [isToolbarSticky, setIsToolbarSticky] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [toolbarStyle, setToolbarStyle] = useState<React.CSSProperties>({});
  const mermaidInitialized = useRef(false);
  const renderedMermaidIds = useRef<Set<string>>(new Set());
  const mermaidRenderScheduled = useRef(false);
  // Track whether content has been converted from markdown to prevent re-conversion
  const contentAlreadyConvertedRef = useRef<boolean>(false);

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
        // Disable gapcursor from StarterKit since we use ConfiguredGapcursor from table extensions
        gapcursor: false,
        // Disable default codeBlock so we can use CodeBlockLowlight for syntax highlighting
        codeBlock: false,
      }),
      // Code block with syntax highlighting
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
        HTMLAttributes: {
          class: 'hljs',
        },
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
      // Table extensions with best practices
      ...tableExtensions,
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
      editorRef.current = editor; // Store editor in ref for useTextSelection hook
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
        // Extract text content from HTML to check for markdown
        // Create a temporary DOM element to extract text
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        
        // Check if pasted content looks like markdown (heuristic check)
        // Common markdown patterns: headers (#), lists (-, *, 1.), code blocks (```), links ([text](url))
        const markdownPatterns = [
          /^#{1,6}\s/m,           // Headers
          /^\s*[-*+]\s/m,         // Unordered lists
          /^\s*\d+\.\s/m,         // Ordered lists
          /^>\s/m,                // Blockquotes
          /```[\s\S]*?```/m,       // Code blocks (including ```mermaid)
          /\[([^\]]+)\]\(([^)]+)\)/m, // Links
          /\*\*[^*]+\*\*/,        // Bold
          /\*[^*]+\*/,            // Italic
          /~~[^~]+~~/,            // Strikethrough
          /`[^`]+`/,              // Inline code
        ];

        // Check if text contains markdown patterns
        const hasMarkdownSyntax = markdownPatterns.some(pattern => pattern.test(textContent));
        
        // If we detect markdown syntax in the text content, convert it
        // This handles cases where markdown was pasted and browser converted some to HTML
        if (hasMarkdownSyntax && textContent.trim().length > 0) {
          // Check if HTML already has rich formatting that suggests it's already converted
          // If HTML has many formatting tags, it might be from a rich text source (not raw markdown)
          const formattingTagCount = html.match(/<(h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|a|p)[^>]*>/gi)?.length || 0;
          
          // Only skip conversion if HTML has substantial formatting (likely from rich text editor)
          // But if text clearly has markdown syntax, prioritize converting it
          if (formattingTagCount < 10 || textContent.includes('```') || textContent.match(/^#{1,6}\s/m)) {
            try {
              // Convert markdown to HTML using marked
              const htmlFromMarkdown = marked.parse(textContent, {
                breaks: false,
                gfm: true, // GitHub Flavored Markdown
              }) as string;
              
              // Return converted HTML for TipTap to parse
              return htmlFromMarkdown;
            } catch (error) {
              console.warn('Failed to parse markdown:', error);
              // Fall back to original HTML if parsing fails
              return html;
            }
          }
        }
        
        // Preserve formatting by returning the HTML as-is
        // TipTap will parse it and preserve supported formatting (bold, italic, colors, etc.)
        return html;
      },
      handleDOMEvents: {
        dblclick: (view, event) => {
          return handleTableDblClick(view, event);
        },
        paste: (view, event) => {
          // Handle plain text paste that might be markdown
          const clipboardData = event.clipboardData;
          if (!clipboardData) return false;

          const text = clipboardData.getData('text/plain');
          const html = clipboardData.getData('text/html');

          // Always check plain text for markdown first, regardless of HTML
          // This ensures we catch markdown even when HTML is present
          if (text && text.trim().length > 0) {
            const markdownPatterns = [
              /^#{1,6}\s/m,           // Headers
              /^\s*[-*+]\s/m,         // Unordered lists
              /^\s*\d+\.\s/m,         // Ordered lists
              /^>\s/m,                // Blockquotes
              /```[\s\S]*?```/m,       // Code blocks (including ```mermaid)
              /\[([^\]]+)\]\(([^)]+)\)/m, // Links
              /\*\*[^*]+\*\*/,        // Bold
              /\*[^*]+\*/,            // Italic
              /~~[^~]+~~/,            // Strikethrough
            ];

            const hasMarkdownSyntax = markdownPatterns.some(pattern => pattern.test(text));

            if (hasMarkdownSyntax) {
              try {
                // Convert markdown to HTML
                const htmlFromMarkdown = marked.parse(text, {
                  breaks: false,
                  gfm: true,
                }) as string;

                // Insert the HTML content using editor instance
                event.preventDefault();
                event.stopPropagation();
                
                if (editorRef.current) {
                  editorRef.current.chain().focus().insertContent(htmlFromMarkdown).run();
                  return true; // Handled
                }
              } catch (error) {
                console.warn('Failed to parse markdown paste:', error);
                // Fall through to default handler
              }
            }
          }

          // Let transformPastedHTML handle HTML-based markdown as fallback
          return false; // Use default paste handler
        },
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

  // Initialize mermaid once
  useEffect(() => {
    if (!mermaidInitialized.current) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
      });
      mermaidInitialized.current = true;
    }
  }, []);

  // Function to render mermaid diagrams - called manually after content is set
  const renderMermaidDiagrams = useCallback(async () => {
    if (!editorContainerRef.current || mermaidRenderScheduled.current) return;
    
    mermaidRenderScheduled.current = true;
    
    // Wait a bit for DOM to settle
    await new Promise(resolve => setTimeout(resolve, 200));
    
    if (!editorContainerRef.current) {
      mermaidRenderScheduled.current = false;
      return;
    }

    const allPreBlocks = editorContainerRef.current.querySelectorAll('pre');
    
    for (const pre of allPreBlocks) {
      const code = pre.querySelector('code');
      if (!code) continue;
      
      const codeContent = code.textContent || '';
      const trimmedContent = codeContent.trim();
      
      // Create a hash of the content to track if we've rendered this
      const contentHash = trimmedContent.substring(0, 50) + trimmedContent.length;
      
      // Skip if already rendered this exact content
      if (renderedMermaidIds.current.has(contentHash)) continue;
      
      // Skip if already has a rendered diagram next to it
      if (pre.nextElementSibling?.classList.contains('mermaid-diagram')) {
        renderedMermaidIds.current.add(contentHash);
        continue;
      }
      
      const isMermaid = code.classList.contains('language-mermaid') || 
                        trimmedContent.startsWith('graph ') ||
                        trimmedContent.startsWith('flowchart ') ||
                        trimmedContent.startsWith('sequenceDiagram') ||
                        trimmedContent.startsWith('classDiagram') ||
                        trimmedContent.startsWith('stateDiagram') ||
                        trimmedContent.startsWith('erDiagram') ||
                        trimmedContent.startsWith('gantt') ||
                        trimmedContent.startsWith('pie') ||
                        trimmedContent.startsWith('journey');
      
      if (isMermaid && trimmedContent) {
        // Mark as rendered BEFORE async operation to prevent duplicates
        renderedMermaidIds.current.add(contentHash);
        
        try {
          const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await mermaid.render(id, trimmedContent);
          
          // Double-check the pre block still exists and doesn't have a diagram
          if (pre.parentNode && !pre.nextElementSibling?.classList.contains('mermaid-diagram')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'mermaid-diagram';
            wrapper.setAttribute('data-content-hash', contentHash);
            wrapper.innerHTML = svg;
            wrapper.style.cssText = 'display: flex; justify-content: center; padding: 1.5rem; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; margin: 1rem 0; overflow-x: auto; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';
            
            (pre as HTMLElement).style.display = 'none';
            pre.parentNode.insertBefore(wrapper, pre.nextSibling);
            
            console.log('[RichTextEditor] Rendered mermaid diagram');
          }
        } catch (error) {
          console.warn('[RichTextEditor] Failed to render mermaid diagram:', error);
        }
      }
    }
    
    mermaidRenderScheduled.current = false;
  }, []);

  // Update editor editability when readOnly changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Prevent mobile browser toolbar from appearing above keyboard
  // Note: Unfortunately, mobile browsers show the toolbar for contentEditable elements
  // and there's no reliable way to hide it without blocking the keyboard.
  // The toolbar is a browser feature that can't be disabled via CSS or attributes.
  // Users will need to dismiss it manually or we accept it as a browser limitation.

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

    let normalizedContent = content || '<p></p>';
    
    // Check if content needs markdown conversion using the new reliable detection
    // Only convert once - once content is HTML, it's canonical and should not be re-converted
    if (normalizedContent && normalizedContent !== '<p></p>') {
      const conversionCheck = detectMarkdownConversionNeeded(normalizedContent);
      
      if (conversionCheck.needsConversion) {
        console.log('[RichTextEditor] Converting markdown to HTML:', conversionCheck.reason);
        normalizedContent = convertMarkdownToHtml(normalizedContent);
        contentAlreadyConvertedRef.current = true;
      } else if (conversionCheck.reason === 'already_converted') {
        // Mark as already converted to prevent re-conversion on subsequent renders
        contentAlreadyConvertedRef.current = true;
        console.log('[RichTextEditor] Content already converted, skipping');
      }
    }
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
          
          // Render mermaid diagrams after content is loaded
          renderMermaidDiagrams();
        }
        isUpdatingRef.current = false;
      }, 100);

      return () => clearTimeout(timeoutId);
    } catch {
      isUpdatingRef.current = false;
    }
  }, [content, editor, renderMermaidDiagrams]);

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

  const handleAskAI = useCallback((position: { docId: string; startOffset: number; endOffset: number }) => {
    setSelectedTextPosition(position);
    // Open AI chat
    window.dispatchEvent(new CustomEvent('openAIChat'));
  }, [setSelectedTextPosition]);

  return (
    <div className="w-full max-w-full">
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
        <TableToolbar editor={editor} getButtonClasses={getButtonClasses} />

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

          </div>
        </div>
      )}

      {/* Editor Content */}
      <div ref={editorContainerRef} className="relative">
        <EditorContent 
          editor={editor} 
          className="min-h-[500px] overflow-x-hidden px-4 sm:px-6 py-6 w-full max-w-full [&_.ProseMirror]:prose [&_.ProseMirror]:prose-base [&_.ProseMirror]:sm:prose-lg [&_.ProseMirror]:max-w-full [&_.ProseMirror]:w-full [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:p-0 [&_.ProseMirror]:mx-0 [&_.ProseMirror]:min-h-[460px] [&_.ProseMirror]:box-border [&_.ProseMirror_p]:my-0 [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:break-words [&_.ProseMirror_p]:overflow-wrap-anywhere [&_.ProseMirror]:break-words [&_.ProseMirror]:overflow-wrap-anywhere [&_.ProseMirror_pre]:max-w-full [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:bg-[#1e1e1e] [&_.ProseMirror_pre]:text-[#d4d4d4] [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:my-4 [&_.ProseMirror_pre]:font-mono [&_.ProseMirror_pre]:text-sm [&_.ProseMirror_pre]:leading-relaxed [&_.ProseMirror_pre]:border [&_.ProseMirror_pre]:border-[#333] [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-sm [&_.ProseMirror_code]:break-words [&_.ProseMirror_code]:max-w-full [&_.ProseMirror_code]:overflow-wrap-anywhere [&_.ProseMirror_:not(pre)>code]:bg-muted [&_.ProseMirror_:not(pre)>code]:px-1.5 [&_.ProseMirror_:not(pre)>code]:py-0.5 [&_.ProseMirror_:not(pre)>code]:rounded [&_.ProseMirror_:not(pre)>code]:text-[#e06c75] [&_.ProseMirror_a]:break-words [&_.ProseMirror_a]:overflow-wrap-anywhere [&_.ProseMirror_ul]:max-w-full [&_.ProseMirror_ol]:max-w-full [&_.ProseMirror_li]:break-words [&_.ProseMirror_li]:overflow-wrap-anywhere [&_.ProseMirror_.table-wrapper]:overflow-x-auto [&_.ProseMirror_.table-wrapper]:my-4 [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border [&_.ProseMirror_table]:border-border [&_.ProseMirror_table]:rounded-md [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:bg-muted/50 [&_.ProseMirror_th]:px-3 [&_.ProseMirror_th]:py-2 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:px-3 [&_.ProseMirror_td]:py-2 [&_.ProseMirror_td]:min-w-[100px] [&_.ProseMirror_td]:break-words [&_.ProseMirror_td]:overflow-wrap-anywhere [&_.ProseMirror_tr:hover_td]:bg-muted/30 [&_.ProseMirror_tr:hover_th]:bg-muted/60" 
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
        />
        <FloatingAskAI
          visible={hasSelection && selectedText.length > 0 && !readOnly && !!selectionPosition}
          position={selectionBounds}
          onAskAI={handleAskAI}
          selectionPosition={selectionPosition}
          selectedText={selectedText}
        />
      </div>
    </div>
  );
}

