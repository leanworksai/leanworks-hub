import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Paragraph from '@tiptap/extension-paragraph';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Image } from '@tiptap/extension-image';
import ImageResize from 'tiptap-extension-resize-image';
import { Markdown } from 'tiptap-markdown';
import { common, createLowlight } from 'lowlight';
import { tableExtensions, handleTableDblClick } from '@/extensions/table';
import '@/extensions/table/styles.css';
import '@/components/code-highlight.css';
import '@/components/editor.css';
import { TableToolbar } from '@/components/editor/TableToolbar';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import mermaid from 'mermaid';
import { useTextSelection } from '@/hooks/useTextSelection';
import { useSelectedTextContext } from '@/contexts/SelectedTextContext';
import { FloatingAskAI } from '@/components/FloatingAskAI';
import { useSidebar } from '@/components/ui/sidebar';
// Auto word wrap hook disabled - CSS handles wrapping naturally
// import { useAutoWordWrap } from '@/hooks/useAutoWordWrap';
import { 
  detectMarkdownConversionNeeded, 
  convertMarkdownToHtml,
  shouldConvertMarkdownPaste,
  shouldPreserveHtmlPaste 
} from '@/utils/markdownConverter';

// Re-export normalizeCodeBlocksForTipTap for use in this file
// We'll define it locally to avoid circular dependencies
// Uses DOMParser for reliable HTML parsing instead of regex
function normalizeCodeBlocksForTipTap(html: string): string {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    // Fallback: return as-is if DOMParser is not available
    return html;
  }
  
  // Use DOMParser for reliable HTML parsing
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Find all code blocks - use querySelectorAll to get all pre elements that contain code
  const preElements = doc.querySelectorAll('pre');
  
  preElements.forEach((preElement) => {
    // Find the code element inside this pre
    const codeElement = preElement.querySelector('code');
    if (!codeElement) return;
    
    // Extract language from class (marked uses "language-{lang}")
    const classList = Array.from(codeElement.classList);
    const languageClass = classList.find(cls => cls.startsWith('language-'));
    
    let language = 'plaintext';
    if (languageClass) {
      // Extract language name (remove "language-" prefix)
      language = languageClass.replace(/^language-/, '');
    }
    
    // CRITICAL: Use textContent to get the unescaped text content
    // TipTap's CodeBlockLowlight expects plain text, not HTML-escaped content
    // This preserves the actual characters (not HTML entities like &quot;)
    const codeContent = codeElement.textContent || '';
    
    // Reconstruct the code block with clean structure
    // This ensures TipTap will parse it as a single code block
    preElement.innerHTML = '';
    const newCodeElement = doc.createElement('code');
    newCodeElement.className = `language-${language}`;
    newCodeElement.textContent = codeContent; // Use textContent, not innerHTML
    preElement.appendChild(newCodeElement);
  });
  
  // Return the normalized HTML from the body
  // Ensure code blocks are properly formatted as atomic units
  const normalizedHtml = doc.body.innerHTML;
  
  // Double-check: verify all code blocks are properly structured
  // This helps catch any issues before TipTap parses them
  const verifyParser = new DOMParser();
  const verifyDoc = verifyParser.parseFromString(normalizedHtml, 'text/html');
  const verifyPreElements = verifyDoc.querySelectorAll('pre');
  
  verifyPreElements.forEach((preElement) => {
    const codeElement = preElement.querySelector('code');
    if (!codeElement) return;
    
    // Ensure code element is the only direct child
    const directChildren = Array.from(preElement.childNodes).filter(
      node => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()
    );
    
    if (directChildren.length !== 1 || directChildren[0] !== codeElement) {
      // Fix: ensure code is the only child
      const codeContent = codeElement.textContent || '';
      const language = codeElement.className.replace(/^language-/, '') || 'plaintext';
      preElement.innerHTML = '';
      const newCode = verifyDoc.createElement('code');
      newCode.className = `language-${language}`;
      newCode.textContent = codeContent;
      preElement.appendChild(newCode);
    }
  });
  
  return verifyDoc.body.innerHTML;
}

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
  Image as ImageIcon,
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
    // Use the utility function which already handles code block normalization
    return convertMarkdownToHtml(markdown);
  } catch (error) {
    return markdown; // Return original if conversion fails
  }
}

/**
 * Detects if content is TipTap JSON format (object or JSON string) vs HTML string
 */
function isJsonContent(content: string | object): boolean {
  if (typeof content === 'object' && content !== null) {
    // Already a JSON object
    return content.hasOwnProperty('type') && (content as any).type === 'doc';
  }
  if (typeof content !== 'string') return false;
  
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && parsed.type === 'doc';
  } catch {
    return false; // Not valid JSON, treat as HTML
  }
}

/**
 * Normalizes content to the format TipTap expects
 * - JSON objects: return as-is
 * - JSON strings: parse to object
 * - HTML strings: return as-is (TipTap will parse it)
 */
function normalizeContentForTipTap(content: string | object): string | object {
  if (!content) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  
  if (typeof content === 'object' && content !== null) {
    return content;
  }
  
  if (typeof content === 'string') {
    // Check if it's JSON string
    if (isJsonContent(content)) {
      try {
        return JSON.parse(content);
      } catch {
        return content; // Fallback to string if parsing fails
      }
    }
    // It's HTML, return as-is
    return content;
  }
  
  return content;
}

interface RichTextEditorProps {
  content: string | object; // Can be HTML string (legacy) or TipTap JSON object/string
  onChange: (content: object) => void; // Returns TipTap JSON object
  placeholder?: string;
  readOnly?: boolean;
  onFileUpload?: (file: File) => Promise<void>;
  onImageAdded?: (fileInfo: { fileId: string; fileName: string; fileUrl: string; fileSize: number; mimeType: string }, docId: string) => Promise<void>; // Callback to add image to attachments, receives saved docId
  docId?: string;
  onSaveFirst?: () => Promise<string | null>; // Callback to save document first if needed, returns new docId
}

export function RichTextEditor({ 
  content, 
  onChange, 
  placeholder = 'Start writing...',
  readOnly = false,
  onFileUpload,
  onImageAdded,
  docId,
  onSaveFirst,
}: RichTextEditorProps) {
  // Normalize initial content - handle both JSON and HTML
  const normalizedInitialContent = normalizeContentForTipTap(content || '<p></p>');
  const initialContentString = typeof normalizedInitialContent === 'string' 
    ? normalizedInitialContent 
    : JSON.stringify(normalizedInitialContent);
  
  const contentRef = useRef<string>(initialContentString);
  const isUpdatingRef = useRef<boolean>(false);
  const editorInitializedRef = useRef<boolean>(false);
  const lastContentPropRef = useRef<string>(initialContentString);
  const isUndoRedoRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { selectedText, hasSelection, selectionBounds, selectionPosition } = useTextSelection(
    editorContainerRef,
    editorRef, // Pass ref instead of editor instance
    docId
  );
  const { setSelectedTextPosition } = useSelectedTextContext();
  const [isUploading, setIsUploading] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const mermaidInitialized = useRef(false);
  
  // Get sidebar state to adjust toolbar position
  const sidebar = useSidebar();
  const sidebarLeft = useMemo(() => {
    if (sidebar.state === 'collapsed' && sidebar.open) {
      // Sidebar is collapsed to icon mode - use icon width (3rem = 48px)
      return '3rem';
    } else if (!sidebar.open) {
      // Sidebar is hidden (offcanvas)
      return '0';
    } else {
      // Sidebar is expanded - use full width (12rem = 192px)
      return '12rem';
    }
  }, [sidebar.state, sidebar.open]);

  // Calculate toolbar left position - centered in content area (accounting for both app sidebar and docs sidebar)
  // Content area starts at: app sidebar width + docs sidebar width (16rem)
  // Content area width: 100vw - app sidebar width - docs sidebar width  
  // Center position: start + width/2 = app sidebar + docs sidebar + (100vw - app sidebar - docs sidebar) / 2
  // Simplified: 50vw + app sidebar/2 + docs sidebar/2 = 50vw + app sidebar/2 + 8rem
  const toolbarLeft = useMemo(() => {
    if (sidebarLeft === '0') {
      // App sidebar closed: center = 50vw + 8rem
      return 'calc(50vw + 8rem)';
    } else {
      // App sidebar open: center = 50vw + app sidebar/2 + 8rem
      return `calc(50vw + ${sidebarLeft} / 2 + 8rem)`;
    }
  }, [sidebarLeft]);
  const renderedMermaidIds = useRef<Set<string>>(new Set());
  const mermaidRenderScheduled = useRef(false);
  // Track whether content has been converted from markdown to prevent re-conversion
  const contentAlreadyConvertedRef = useRef<boolean>(false);

  const baseToolbarClasses = 'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-75';
  const activeToolbarClasses = '!bg-primary !text-primary-foreground hover:!bg-primary/90 shadow-sm !transition-none';
  const getButtonClasses = (isActive: boolean) =>
    cn('rounded-md', isActive ? activeToolbarClasses : baseToolbarClasses);

  // Create refs for auto-wrap handlers (will be set after editor is created)
  const autoWrapHandlersRef = useRef<{
    handleInput: ((view: any, event: Event) => boolean) | null;
    handleCompositionEnd: ((view: any, event: Event) => boolean) | null;
    handleTouchEnd: ((view: any, event: Event) => boolean) | null;
    handleBlur: ((view: any, event: Event) => boolean) | null;
  }>({ handleInput: null, handleCompositionEnd: null, handleTouchEnd: null, handleBlur: null });

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
      // Custom paragraph extension that preserves trailing spaces and formatting
      Paragraph.extend({
        parseHTML() {
          return [{ tag: 'p' }];
        },
        renderHTML({ HTMLAttributes }) {
          return ['p', { ...HTMLAttributes, style: 'white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; hyphens: none; max-width: 100%; width: 100%; box-sizing: border-box;' }, 0];
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline break-all',
          style: 'word-break: break-all; overflow-wrap: anywhere;',
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph', 'tableCell'],
      }),
      // Table extensions with best practices
      ...tableExtensions,
      Color,
      TextStyle,
      // Image extension with resize capability
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      // Image resize extension - enables drag handles for resizing
      ImageResize.configure({
        inline: true,
      }),
      // Markdown extension for markdown copy/export support
      Markdown.configure({
        html: true,
        transformPastedText: false,
        transformCopiedText: false,
      }),
    ],
    content: normalizedInitialContent,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      // Only call onChange if we're not in the middle of a programmatic update
      if (!isUpdatingRef.current) {
        // Use JSON format instead of HTML - this is TipTap's native format
        // and avoids all HTML parsing issues
        const json = editor.getJSON();
        const jsonString = JSON.stringify(json);
        contentRef.current = jsonString;
        
        if (isUndoRedoRef.current) {
          // During undo/redo, update lastContentPropRef to prevent useEffect from interfering
          // but still call onChange to keep parent state in sync
          lastContentPropRef.current = jsonString;
          onChange(json);
          // Reset the flag after a short delay to allow undo/redo to complete
          setTimeout(() => {
            isUndoRedoRef.current = false;
          }, 0);
        } else {
          // Normal update - update refs and call onChange
          lastContentPropRef.current = jsonString;
          onChange(json);
        }
      }
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor; // Store editor in ref for useTextSelection hook
      editorInitializedRef.current = true;
      const initialJson = editor.getJSON();
      const initialJsonString = JSON.stringify(initialJson);
      contentRef.current = initialJsonString;
      
      // Initialize with the actual content prop
      // Handle both JSON (new format) and HTML (legacy format) for backward compatibility
      const contentToSet = normalizeContentForTipTap(content || '<p></p>');
      const contentString = typeof contentToSet === 'string' 
        ? contentToSet 
        : JSON.stringify(contentToSet);
      
      lastContentPropRef.current = contentString;
      
      // Always set content from prop if it's different (handles case where content loads after mount)
      if (contentString !== initialJsonString) {
        // Use setTimeout to ensure editor is fully ready
        setTimeout(() => {
          if (!editor.isDestroyed) {
            // setContent can accept both HTML string and JSON object
            editor.commands.setContent(contentToSet, false);
            contentRef.current = contentString;
          }
        }, 0);
      }
    },
    editorProps: {
      attributes: {
        class: 'w-full focus:outline-none min-h-[300px] max-w-full overflow-x-hidden',
        style: 'white-space: normal !important; margin: 0; overflow-wrap: break-word; word-break: break-word; hyphens: none; max-width: 100%; width: 100%; box-sizing: border-box; overflow-x: hidden;',
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
        'data-gramm': 'false', // Disable Grammarly to prevent conflicts
      },
      transformPastedHTML(html) {
        // Extract text content from HTML to check for markdown
        // Create a temporary DOM element to extract text
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        
        // First, check if content has rich formatting or special characters that should be preserved
        // If HTML has substantial formatting OR special Unicode characters, preserve it as-is
        const formattingTagCount = html.match(/<(h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|a|p|br|div|span)[^>]*>/gi)?.length || 0;
        const hasRichFormatting = formattingTagCount >= 5;
        
        // Check for Unicode characters that indicate rich formatted content
        // These are NOT standard markdown and should be preserved
        const hasUnicodeFormatting = /[•⸻👉📱🖥\u2022\u2013\u2014\u2018-\u201F\u2026\uFE0E-\uFE0F\u{1F300}-\u{1F9FF}]/u.test(textContent);
        
        // Check for tabs used for indentation (common in formatted text, not typical in raw markdown)
        const hasTabs = /\t/.test(textContent);
        
        // If content has rich formatting, Unicode characters, or tabs, preserve it as-is
        // This prevents loss of special formatting during markdown conversion
        if (hasRichFormatting || hasUnicodeFormatting || hasTabs) {
          return html;
        }
        
        // Check if pasted content looks like PURE markdown (strict check)
        // Only convert if it's clearly raw markdown without HTML formatting
        const strictMarkdownPatterns = [
          /^#{1,6}\s/m,           // Headers at line start
          /^\s*[-*+]\s/m,         // Standard markdown lists (-, *, +) at line start
          /^\s*\d+\.\s/m,         // Ordered lists at line start
          /^>\s/m,                // Blockquotes at line start
          /```[\s\S]*?```/m,       // Code blocks (including ```mermaid)
        ];

        // Check if text contains strict markdown patterns
        const hasStrictMarkdownSyntax = strictMarkdownPatterns.some(pattern => pattern.test(textContent));
        
        // Only convert if:
        // 1. Has strict markdown syntax
        // 2. Has minimal HTML (less than 3 tags - likely just wrapper divs/spans from clipboard)
        // 3. No rich formatting already present
        if (hasStrictMarkdownSyntax && formattingTagCount < 3 && textContent.trim().length > 0) {
          try {
            // Convert markdown to HTML using marked
            const htmlFromMarkdown = marked.parse(textContent, {
              breaks: true, // Preserve line breaks for better formatting
              gfm: true, // GitHub Flavored Markdown
            }) as string;
            
            // Normalize code blocks for TipTap compatibility
            const normalizedHtml = normalizeCodeBlocksForTipTap(htmlFromMarkdown);
            
            // Return converted HTML for TipTap to parse
            return normalizedHtml;
          } catch (error) {
            // Fall back to original HTML if parsing fails
            return html;
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
        copy: (view, event) => {
          // Custom copy handler to copy as markdown (with HTML and plain text fallbacks)
          const editor = editorRef.current;
          if (!editor) return false;

          try {
            const { from, to } = editor.state.selection;
            const hasSelection = from !== to;

            let markdown: string;
            let html: string;
            let text: string;

            if (hasSelection) {
              // Copy selected content
              // For selections, get the HTML and text first
              html = editor.getHTML({ from, to });
              text = editor.state.doc.textBetween(from, to);
              
              // Try to get markdown for the selection
              // Note: tiptap-markdown may not support selection directly,
              // so we'll use HTML-to-markdown conversion for selections if needed
              if (editor.storage.markdown?.getMarkdown) {
                try {
                  // Create a temporary document with just the selection
                  const selectedFragment = editor.state.doc.slice(from, to);
                  // For now, use HTML and let the markdown extension handle it
                  // or convert HTML to markdown using a simple approach
                  markdown = text; // Fallback to plain text for selections
                  // TODO: Could enhance this with HTML-to-markdown conversion
                } catch (e) {
                  markdown = text;
                }
              } else {
                markdown = text;
              }
            } else {
              // Copy entire document
              html = editor.getHTML();
              text = editor.getText();
              
              if (editor.storage.markdown?.getMarkdown) {
                markdown = editor.storage.markdown.getMarkdown();
              } else {
                markdown = text;
              }
            }

            // Set clipboard data with multiple formats
            const clipboardData = (event as ClipboardEvent).clipboardData;
            if (clipboardData) {
              // Primary format: Markdown (for tools like GitHub, Notion, Slack, etc.)
              clipboardData.setData('text/markdown', markdown);
              
              // Fallback: HTML (for rich text editors)
              clipboardData.setData('text/html', html);
              
              // Fallback: Plain text (for plain text editors)
              clipboardData.setData('text/plain', text);
            }

            // Return false to allow default copy behavior to also run
            // This ensures the selection is still copied visually
            return false;
          } catch (error) {
            console.error('Failed to copy as markdown:', error);
            // Fall back to default copy behavior
            return false;
          }
        },
        paste: (view, event) => {
          // Handle plain text paste that might be markdown
          const clipboardData = event.clipboardData;
          if (!clipboardData) return false;

          const text = clipboardData.getData('text/plain');
          const html = clipboardData.getData('text/html');

          // Check if we should prefer the HTML (has rich formatting or special characters)
          if (html && html.trim().length > 0) {
            const formattingTagCount = html.match(/<(h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|a|p|br|div|span)[^>]*>/gi)?.length || 0;
            const hasRichFormatting = formattingTagCount >= 5;
            
            // Check for Unicode characters that indicate rich formatted content
            const hasUnicodeFormatting = /[•⸻👉📱🖥\u2022\u2013\u2014\u2018-\u201F\u2026\uFE0E-\uFE0F\u{1F300}-\u{1F9FF}]/u.test(text);
            
            // Check for tabs
            const hasTabs = /\t/.test(text);
            
            // If HTML has rich formatting or special characters, let transformPastedHTML handle it
            if (hasRichFormatting || hasUnicodeFormatting || hasTabs) {
              return false; // Use default paste handler with transformPastedHTML
            }
          }

          // Only check plain text for STRICT markdown patterns if no rich HTML
          if (text && text.trim().length > 0) {
            // Use stricter patterns - only convert obvious raw markdown
            const strictMarkdownPatterns = [
              /^#{1,6}\s/m,           // Headers at line start
              /^\s*[-*+]\s/m,         // Standard markdown lists (-, *, +) at line start
              /^\s*\d+\.\s/m,         // Ordered lists at line start
              /^>\s/m,                // Blockquotes at line start
              /```[\s\S]*?```/m,       // Code blocks (including ```mermaid)
            ];

            const hasStrictMarkdownSyntax = strictMarkdownPatterns.some(pattern => pattern.test(text));
            
            // Only convert if it's strict markdown AND no rich HTML is present
            const hasMinimalHtml = !html || (html.match(/<[^>]+>/g)?.length || 0) < 3;

            if (hasStrictMarkdownSyntax && hasMinimalHtml) {
              try {
                // Convert markdown to HTML
                const htmlFromMarkdown = marked.parse(text, {
                  breaks: true, // Preserve line breaks
                  gfm: true,
                }) as string;

                // Normalize code blocks for TipTap compatibility
                const normalizedHtml = normalizeCodeBlocksForTipTap(htmlFromMarkdown);

                // Insert the HTML content using editor instance
                event.preventDefault();
                event.stopPropagation();
                
                if (editorRef.current) {
                  editorRef.current.chain().focus().insertContent(normalizedHtml).run();
                  return true; // Handled
                }
              } catch (error) {
                // Fall through to default handler
              }
            }
          }

          // Let transformPastedHTML handle HTML-based content
          return false; // Use default paste handler
        },
        input: (view, event) => {
          return autoWrapHandlersRef.current.handleInput?.(view, event) ?? false;
        },
        compositionend: (view, event) => {
          return autoWrapHandlersRef.current.handleCompositionEnd?.(view, event) ?? false;
        },
        touchend: (view, event) => {
          return autoWrapHandlersRef.current.handleTouchEnd?.(view, event) ?? false;
        },
        blur: (view, event) => {
          return autoWrapHandlersRef.current.handleBlur?.(view, event) ?? false;
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
          // Skip this on mobile devices to avoid interfering with keyboard word detection
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
          if (!isMobile && (event.key === ' ' || event.keyCode === 32)) {
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

  // Auto word wrap hook disabled - CSS handles wrapping naturally
  // The auto-wrap was inserting hard breaks which caused issues on mobile
  // With proper CSS (overflow-wrap: break-word, hyphens: none), browser handles wrapping
  // const { handleInput, handleCompositionEnd, handleTouchEnd, handleBlur } = useAutoWordWrap(editor);
  
  // Disable auto-wrap handlers - return false to use default behavior
  useEffect(() => {
    autoWrapHandlersRef.current = { 
      handleInput: () => false, 
      handleCompositionEnd: () => false, 
      handleTouchEnd: () => false, 
      handleBlur: () => false 
    };
  }, []);

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
          }
        } catch (error) {
          // Failed to render mermaid diagram
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

  // Debug: Check word breaking styles on paragraphs and detect broken words
  useEffect(() => {
    if (!editorContainerRef.current || readOnly) return;
    
    const checkWordBreaking = () => {
      const proseMirror = editorContainerRef.current?.querySelector('.ProseMirror');
      if (!proseMirror) return;
      
      const paragraphs = proseMirror.querySelectorAll('p');
      if (paragraphs.length === 0) return;
      
      // Check the first few paragraphs for word breaking styles
      paragraphs.forEach((p, idx) => {
        if (idx < 5) { // Check first 5 paragraphs
          const htmlP = p as HTMLElement;
          const computedStyle = window.getComputedStyle(htmlP);
          const textContent = htmlP.textContent || '';
          
          // Detect broken words by checking if words appear split across lines
          const words = textContent.split(/\s+/).filter(w => w.length > 0);
          const potentiallyBrokenWords: string[] = [];
          
          words.forEach(word => {
            if (word.length > 6) { // Check words longer than 6 characters
              // Try to find the word in the DOM and check if it's broken
              const textNodes: Text[] = [];
              const walker = document.createTreeWalker(
                htmlP,
                NodeFilter.SHOW_TEXT,
                null
              );
              
              let node;
              while (node = walker.nextNode()) {
                if (node.textContent?.includes(word)) {
                  textNodes.push(node as Text);
                }
              }
              
              // Check if word appears in multiple text nodes (might be broken)
              if (textNodes.length > 1) {
                potentiallyBrokenWords.push(word);
              } else if (textNodes.length === 1) {
                // Check if the word's bounding box suggests it's broken
                const range = document.createRange();
                try {
                  const textNode = textNodes[0];
                  const wordIndex = textNode.textContent?.indexOf(word);
                  if (wordIndex !== undefined && wordIndex >= 0) {
                    range.setStart(textNode, wordIndex);
                    range.setEnd(textNode, wordIndex + word.length);
                    const rects = range.getClientRects();
                    // If word has multiple rects, it's likely broken across lines
                    if (rects.length > 1) {
                      potentiallyBrokenWords.push(word);
                    }
                  }
                } catch (e) {
                  // Ignore errors
                }
              }
            }
          });
        }
      });
    };
    
    const timeoutId = setTimeout(checkWordBreaking, 500);
    return () => clearTimeout(timeoutId);
  }, [content, editor, readOnly]);

  // Debug: Check for overflow issues at multiple levels
  useEffect(() => {
    if (!editorContainerRef.current || readOnly) return;
    
    const checkOverflow = () => {
      // Check body and html for overflow
      const body = document.body;
      const html = document.documentElement;
      const viewportWidth = window.innerWidth;
      
      if (body.scrollWidth > viewportWidth) {
        // Find the widest element
        const allElements = body.querySelectorAll('*');
        let widestElement: { element: HTMLElement; width: number; tag: string; className: string } | null = null;
        
        allElements.forEach((el) => {
          const htmlEl = el as HTMLElement;
          const computedStyle = window.getComputedStyle(htmlEl);
          // Skip elements that are meant to scroll or are hidden
          if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') return;
          
          const width = htmlEl.offsetWidth || htmlEl.scrollWidth;
          if (width > viewportWidth && (!widestElement || width > widestElement.width)) {
            widestElement = {
              element: htmlEl,
              width,
              tag: el.tagName,
              className: el.className || '',
            };
          }
        });
        
        // Widest element found for debugging if needed
      }
      
      // Check HTML overflow
      
      // Check the root container
      const rootContainer = document.querySelector('.animate-fade-in.w-full');
      if (rootContainer) {
        const rootEl = rootContainer as HTMLElement;
        // Check root container overflow
      }
      
      // Check the editor wrapper in DocDetail
      const docContainer = rootContainer?.querySelector('.border.border-border\\/30');
      if (docContainer) {
        const docEl = docContainer as HTMLElement;
        // Check doc container overflow
      }
      
      // Check our editor container
      const container = editorContainerRef.current;
      if (!container) return;
      
      // Check editor container overflow
      
      // Check EditorContent wrapper
      const editorContent = container.querySelector('[data-testid="editor-content"], .ProseMirror');
      if (editorContent) {
        const contentEl = editorContent as HTMLElement;
        // Check editor content overflow
      }
      
      // Check ProseMirror element
      const proseMirror = container.querySelector('.ProseMirror');
      if (!proseMirror) return;
      
      const pmEl = proseMirror as HTMLElement;
      // Check ProseMirror overflow
      
      // Find all potentially overflowing elements inside ProseMirror
      const allElements = proseMirror.querySelectorAll('*');
      const overflowingElements: Array<{element: Element; scrollWidth: number; offsetWidth: number; tag: string; className: string; text: string}> = [];
      
      allElements.forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        const computedStyle = window.getComputedStyle(htmlEl);
        // Skip elements that are meant to scroll (code blocks, tables)
        if (computedStyle.overflowX === 'auto' || computedStyle.overflowX === 'scroll') {
          return;
        }
        
        if (htmlEl.scrollWidth > htmlEl.offsetWidth && htmlEl.scrollWidth > container.offsetWidth) {
          overflowingElements.push({
            element: el,
            scrollWidth: htmlEl.scrollWidth,
            offsetWidth: htmlEl.offsetWidth,
            tag: el.tagName,
            className: el.className,
            text: el.textContent?.substring(0, 100) || '',
          });
        }
      });
      
      // Check for overflowing elements
    };
    
    // Check multiple times to catch dynamic content
    const timeoutId1 = setTimeout(checkOverflow, 100);
    const timeoutId2 = setTimeout(checkOverflow, 500);
    const timeoutId3 = setTimeout(checkOverflow, 1000);
    
    // Also check on window resize
    window.addEventListener('resize', checkOverflow);
    
    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      clearTimeout(timeoutId3);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [content, editor, readOnly]);

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

    // Normalize content - handle both JSON and HTML formats
    let contentToSet: string | object = normalizeContentForTipTap(content || '<p></p>');
    
    // For HTML strings, check if markdown conversion is needed (backward compatibility)
    if (typeof contentToSet === 'string' && contentToSet !== '<p></p>') {
      const conversionCheck = detectMarkdownConversionNeeded(contentToSet);
      
      if (conversionCheck.needsConversion) {
        contentToSet = convertMarkdownToHtml(contentToSet);
        contentAlreadyConvertedRef.current = true;
      } else if (conversionCheck.reason === 'already_converted') {
        // Mark as already converted to prevent re-conversion on subsequent renders
        contentAlreadyConvertedRef.current = true;
      }
    }
    
    // Convert to string for comparison
    const contentString = typeof contentToSet === 'string' 
      ? contentToSet 
      : JSON.stringify(contentToSet);
    
    // Skip if content prop hasn't changed from what we last processed
    if (contentString === lastContentPropRef.current) {
      return;
    }

    // Get current editor content to compare (as JSON string)
    const currentEditorJson = editor.getJSON();
    const currentEditorContentString = JSON.stringify(currentEditorJson);

    // If the editor content already matches the new content prop, 
    // this change came from user typing (onChange was called), so don't update
    // Updating would reset cursor position and cause it to jump
    if (currentEditorContentString === contentString) {
      // Just update the ref to prevent unnecessary updates
      lastContentPropRef.current = contentString;
      contentRef.current = contentString;
      return;
    }

    // Only update if content is significantly different (e.g., loading a new note from database)
    // This prevents cursor jumps during typing
    isUpdatingRef.current = true;
    lastContentPropRef.current = contentString;

    try {
      // Save selection state before updating content
      const selection = editor.state.selection;
      const { from, to } = selection;
      
      // Use a timeout to ensure editor is ready and to batch updates
      const timeoutId = setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          // setContent accepts both HTML string and JSON object
          editor.commands.setContent(contentToSet, false);
          contentRef.current = contentString;
          
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

  // Track keyboard visibility on mobile using viewport height as source of truth
  useEffect(() => {
    if (readOnly || window.innerWidth >= 640) return;
    
    // Store initial window height for comparison (captured once on mount)
    const initialHeight = window.innerHeight;
    let resizeTimeout: NodeJS.Timeout;
    let scrollTimeout: NodeJS.Timeout;
    let lastKnownKeyboardVisible = false;
    
    // Use viewport height as the source of truth for keyboard visibility
    const updateKeyboardVisibility = () => {
      if (!window.visualViewport) return;
      
      const viewport = window.visualViewport;
      const heightDiff = initialHeight - viewport.height;
      // Use 100px threshold (more reliable across devices)
      const keyboardCurrentlyVisible = heightDiff > 100;
      
      // Update state if keyboard visibility changed
      setIsKeyboardVisible(prev => {
        if (prev !== keyboardCurrentlyVisible) {
          lastKnownKeyboardVisible = keyboardCurrentlyVisible;
          return keyboardCurrentlyVisible;
        }
        return prev;
      });
    };
    
    // Debounce viewport resize to avoid rapid state changes
    const handleViewportResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        updateKeyboardVisibility();
      }, 50);
    };
    
    // Handle viewport scroll - force toolbar re-render when viewport scrolls during keyboard visibility
    // This ensures the portal-rendered toolbar stays at the correct position during auto-scroll
    const handleViewportScroll = () => {
      // Only handle scroll when keyboard is visible
      if (!lastKnownKeyboardVisible) return;
      
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        // Force toolbar re-render by triggering state update
        // This repositions the fixed toolbar to the new viewport position
        setIsKeyboardVisible(prev => prev);
      }, 50);
    };
    
    if (window.visualViewport) {
      // Listen to resize events on visualViewport
      window.visualViewport.addEventListener('resize', handleViewportResize);
      
      // Listen to scroll events on visualViewport (only when keyboard is triggered)
      // This ensures toolbar stays visible during auto-scroll when user clicks on text below
      window.visualViewport.addEventListener('scroll', handleViewportScroll);
      
      // Initial check
      updateKeyboardVisibility();
      
      return () => {
        window.visualViewport?.removeEventListener('resize', handleViewportResize);
        window.visualViewport?.removeEventListener('scroll', handleViewportScroll);
        if (resizeTimeout) clearTimeout(resizeTimeout);
        if (scrollTimeout) clearTimeout(scrollTimeout);
      };
    }
  }, [readOnly]);

  // Toolbar is now fixed at bottom, no sticky positioning needed

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

  const handleAskAI = useCallback((position: { docId: string; startOffset: number; endOffset: number; text?: string }) => {
    setSelectedTextPosition(position);
    // Open AI chat
    window.dispatchEvent(new CustomEvent('openAIChat'));
  }, [setSelectedTextPosition]);

  // Image upload handler
  const handleImageUpload = useCallback(async (file: File) => {
    if (!editor) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const fileName = file.name.toLowerCase();
    const isValidType = validTypes.includes(file.type) || 
                        validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!isValidType) {
      alert('Only image files are allowed (JPG, PNG, WebP, GIF)');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image size exceeds 10MB limit');
      return;
    }

    setIsUploading(true);
    try {
      // If docId is 'new', save the document first to get a real docId
      let actualDocId = docId;
      if (!docId || docId === 'new') {
        if (onSaveFirst) {
          const savedDocId = await onSaveFirst();
          if (savedDocId) {
            actualDocId = savedDocId;
          } else {
            throw new Error('Failed to save document. Please try again.');
          }
        } else {
          throw new Error('Document must be saved before uploading images. Please save the document first.');
        }
      }

      if (!actualDocId || actualDocId === 'new') {
        throw new Error('Invalid document ID. Please save the document first.');
      }

      // Import fileUploadService dynamically
      const { fileUploadService } = await import('@/services/api');
      
      // Upload image
      const result = await fileUploadService.uploadFile(actualDocId, file);
      
      // Insert image at current cursor position
      // chain().focus() ensures editor is focused and cursor position is maintained
      // setImage() inserts the image at the current cursor position
      editor.chain().focus().setImage({ 
        src: result.fileUrl, 
        alt: result.fileName 
      }).run();
      
      // Add to attachments using onImageAdded callback (avoids re-upload and docId check)
      if (onImageAdded) {
        await onImageAdded({
          fileId: result.fileId,
          fileName: result.fileName,
          fileUrl: result.fileUrl,
          fileSize: result.fileSize,
          mimeType: result.mimeType,
        }, actualDocId);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to upload image');
    } finally {
      setIsUploading(false);
    }
  }, [docId, editor, onImageAdded, onSaveFirst]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only set dragging to false if we're leaving the container itself
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Filter and validate image files
    const imageFiles = files.filter(file => {
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const fileName = file.name.toLowerCase();
      const isValidType = validTypes.includes(file.type) || 
                          validExtensions.some(ext => fileName.endsWith(ext));
      
      if (!isValidType) {
        return false;
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        return false;
      }

      return true;
    });

    if (imageFiles.length === 0) {
      alert('No valid image files found. Please drop image files (JPG, PNG, WebP, GIF) that are under 10MB.');
      return;
    }

    // Set cursor position at drop location before inserting images
    if (editor && editorContainerRef.current) {
      const proseMirror = editorContainerRef.current.querySelector('.ProseMirror');
      if (proseMirror) {
        const coords = { left: e.clientX, top: e.clientY };
        const pos = editor.view.posAtCoords(coords);
        if (pos) {
          // Set cursor position at drop location
          editor.commands.setTextSelection(pos.pos);
        }
      }
    }

    // Upload and insert each image at the cursor position (now set to drop location)
    for (const file of imageFiles) {
      await handleImageUpload(file);
    }
  }, [handleImageUpload, editor]);

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Toolbar Container - only visible in edit mode */}
      {!readOnly && (
        <>
          {/* Desktop Toolbar - fixed at bottom, centered in content area */}
          <div 
            key={`toolbar-${sidebarLeft}`}
            className="hidden sm:flex fixed bottom-4 z-50" 
            style={{ 
              left: toolbarLeft,
              transform: 'translateX(-50%)'
            }}
          >
            <div className="flex items-center gap-1 px-4 py-2.5 bg-background/95 backdrop-blur-sm border border-border/20 rounded-full shadow-lg overflow-x-auto">
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

        {/* Image Upload */}
        {onFileUpload && (
          <>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                await handleImageUpload(file);
                // Reset input
                if (imageInputRef.current) {
                  imageInputRef.current.value = '';
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => imageInputRef.current?.click()}
              disabled={isUploading}
              title="Insert image (max 10MB)"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
          </>
        )}

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
        </>
      )}

      {/* Editor Content - add padding when toolbar is visible */}
      <div 
        ref={editorContainerRef} 
        className={cn(
          "relative overflow-x-hidden min-w-0",
          isDragging && "border-2 border-primary border-dashed rounded-lg",
          !readOnly && "pb-20 sm:pb-0" // Padding for desktop bottom toolbar
        )}
        style={{ maxWidth: '100%', width: '100%', wordBreak: 'break-word', overflowWrap: 'break-word' }}
        onDragOver={!readOnly ? handleDragOver : undefined}
        onDragLeave={!readOnly ? handleDragLeave : undefined}
        onDrop={!readOnly ? handleDrop : undefined}
      >
        {/* Mobile Toolbar - fixed at viewport top when keyboard is open (always visible) */}
        {/* Rendered via portal to bypass parent transform context */}
        {!readOnly && isKeyboardVisible && createPortal(
          <div className="sm:hidden fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border/20 shadow-lg">
            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex items-center gap-1 px-2 py-2.5 min-w-max">
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

              {/* Image Upload */}
              {onFileUpload && (
                <>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await handleImageUpload(file);
                      if (imageInputRef.current) {
                        imageInputRef.current.value = '';
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isUploading}
                    title="Insert image (max 10MB)"
                  >
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                </>
              )}

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

                      if (file.size > 10 * 1024 * 1024) {
                        alert('File size exceeds 10MB limit');
                        return;
                      }

                      setIsUploading(true);
                      try {
                        await onFileUpload(file);
                      } catch (error) {
                        alert(error instanceof Error ? error.message : 'Failed to upload file');
                      } finally {
                        setIsUploading(false);
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
          </div>,
          document.body
        )}
        <EditorContent
          editor={editor}
          className="min-h-[500px] overflow-x-hidden px-2 sm:px-3 py-4 w-full max-w-full [&_.ProseMirror]:prose [&_.ProseMirror]:prose-base [&_.ProseMirror]:sm:prose-lg [&_.ProseMirror]:max-w-full [&_.ProseMirror]:w-full [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:whitespace-normal [&_.ProseMirror]:p-0 [&_.ProseMirror]:mx-0 [&_.ProseMirror]:min-h-[460px] [&_.ProseMirror]:box-border [&_.ProseMirror]:overflow-x-hidden [&_.ProseMirror]:max-w-full [&_.ProseMirror_p]:my-0 [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:max-w-full [&_.ProseMirror_p]:box-border [&_.ProseMirror_p]:whitespace-normal [&_.ProseMirror_pre]:max-w-full [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:bg-[#1e1e1e] [&_.ProseMirror_pre]:text-[#d4d4d4] [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:my-4 [&_.ProseMirror_pre]:font-mono [&_.ProseMirror_pre]:text-sm [&_.ProseMirror_pre]:leading-relaxed [&_.ProseMirror_pre]:border [&_.ProseMirror_pre]:border-[#333] [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-sm [&_.ProseMirror_code]:break-words [&_.ProseMirror_code]:max-w-full [&_.ProseMirror_code]:break-words [&_.ProseMirror_:not(pre)>code]:bg-muted [&_.ProseMirror_:not(pre)>code]:px-1.5 [&_.ProseMirror_:not(pre)>code]:py-0.5 [&_.ProseMirror_:not(pre)>code]:rounded [&_.ProseMirror_:not(pre)>code]:text-[#e06c75] [&_.ProseMirror_a]:break-words [&_.ProseMirror_ul]:max-w-full [&_.ProseMirror_ol]:max-w-full [&_.ProseMirror_li]:break-words [&_.ProseMirror_li]:whitespace-normal [&_.ProseMirror_.table-wrapper]:overflow-x-auto [&_.ProseMirror_.table-wrapper]:my-4 [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border [&_.ProseMirror_table]:border-border [&_.ProseMirror_table]:rounded-md [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:bg-muted/50 [&_.ProseMirror_th]:px-3 [&_.ProseMirror_th]:py-2 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:px-3 [&_.ProseMirror_td]:py-2 [&_.ProseMirror_td]:min-w-[100px] [&_.ProseMirror_td]:break-words [&_.ProseMirror_tr:hover_td]:bg-muted/30 [&_.ProseMirror_tr:hover_th]:bg-muted/60"
          style={{ wordBreak: 'break-word', overflowWrap: 'break-word', hyphens: 'none', overflowX: 'hidden', maxWidth: '100%', width: '100%' }}
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

// Default export for compatibility
export default RichTextEditor;

