import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Paragraph from '@tiptap/extension-paragraph';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Markdown } from 'tiptap-markdown';
import { common, createLowlight } from 'lowlight';
import { tableExtensions, handleTableDblClick } from '@/extensions/table';
import '@/extensions/table/styles.css';
import '@/components/code-highlight.css';
import '@/components/editor.css';
import { TableToolbar } from '@/components/editor/TableToolbar';
import { useEffect, useRef, useState, useCallback } from 'react';
import { marked } from 'marked';
import mermaid from 'mermaid';
import { useTextSelection } from '@/hooks/useTextSelection';
import { useSelectedTextContext } from '@/contexts/SelectedTextContext';
import { FloatingAskAI } from '@/components/FloatingAskAI';
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
  const [isScrolled, setIsScrolled] = useState(false);
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
      // Custom paragraph extension that preserves trailing spaces
      Paragraph.extend({
        parseHTML() {
          return [{ tag: 'p' }];
        },
        renderHTML({ HTMLAttributes }) {
          return ['p', { ...HTMLAttributes, style: 'white-space: normal; word-break: break-word; overflow-wrap: break-word; hyphens: none; max-width: 100%; width: 100%; box-sizing: border-box;' }, 0];
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
              
              // Normalize code blocks for TipTap compatibility
              const normalizedHtml = normalizeCodeBlocksForTipTap(htmlFromMarkdown);
              
              // Return converted HTML for TipTap to parse
              // TipTap will parse this with its default parseOptions
              return normalizedHtml;
            } catch (error) {
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

                // Normalize code blocks for TipTap compatibility
                const normalizedHtml = normalizeCodeBlocksForTipTap(htmlFromMarkdown);

                // Insert the HTML content using editor instance
                // Use insertContent with parseOptions to preserve code block structure
                event.preventDefault();
                event.stopPropagation();
                
                if (editorRef.current) {
                  // Insert content - TipTap will parse it with default options
                  // The normalized HTML should have properly structured code blocks
                  editorRef.current.chain().focus().insertContent(normalizedHtml).run();
                  return true; // Handled
                }
              } catch (error) {
                // Fall through to default handler
              }
            }
          }

          // Let transformPastedHTML handle HTML-based markdown as fallback
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

  // Handle toolbar sticky positioning on scroll - show when scrolling down
  useEffect(() => {
    if (!toolbarRef.current || !toolbarContainerRef.current || readOnly) return;

    const updateStickyState = () => {
      const container = toolbarContainerRef.current;
      const toolbar = toolbarRef.current;
      if (!container || !toolbar) return;

      const headerHeight = 64; // Header is h-16 (64px)
      const containerRect = container.getBoundingClientRect();
      const toolbarTop = containerRect.top;
      
      // Make toolbar sticky when it reaches or passes the header
      const shouldBeSticky = toolbarTop <= headerHeight;
      
      setIsScrolled(shouldBeSticky);

      if (shouldBeSticky) {
        // Toolbar should be fixed at the very top of the screen
        setToolbarStyle({
          position: 'fixed',
          top: '0px',
          left: `${containerRect.left}px`,
          width: `${containerRect.width}px`,
          zIndex: 50,
        });
      } else {
        // Toolbar in normal flow
        setToolbarStyle({});
      }
    };

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
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Toolbar Container */}
      {!readOnly && (
        <div ref={toolbarContainerRef}>
          {/* Spacer to prevent layout shift when toolbar becomes fixed */}
          {isScrolled && toolbarRef.current && (
            <div style={{ height: `${toolbarRef.current.offsetHeight}px` }} />
          )}
          {/* Toolbar - Always visible, fixed position when scrolling down */}
          <div 
            ref={toolbarRef}
            className="z-50 border-b border-border/20 bg-background/95 backdrop-blur-sm pl-3.5 pr-2.5 py-2.5 flex flex-wrap items-center gap-1 overflow-x-auto overflow-y-visible shadow-md transition-all"
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
      <div ref={editorContainerRef} className="relative overflow-x-hidden min-w-0" style={{ maxWidth: '100%', width: '100%', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
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

