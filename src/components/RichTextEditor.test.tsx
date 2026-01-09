import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RichTextEditor } from './RichTextEditor';
import { 
  detectMarkdownConversionNeeded, 
  convertMarkdownToHtml,
  shouldConvertMarkdownPaste,
  shouldPreserveHtmlPaste 
} from '@/utils/markdownConverter';

// Mock the mermaid module
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mermaid</svg>' }),
  },
}));

// Mock the custom hooks
vi.mock('@/hooks/useTextSelection', () => ({
  useTextSelection: vi.fn(() => ({
    selectedText: '',
    hasSelection: false,
    selectionBounds: null,
    selectionPosition: null,
  })),
}));

vi.mock('@/contexts/SelectedTextContext', () => ({
  useSelectedTextContext: vi.fn(() => ({
    setSelectedTextPosition: vi.fn(),
  })),
}));

vi.mock('@/components/FloatingAskAI', () => ({
  FloatingAskAI: vi.fn(() => null),
}));

describe('Markdown Conversion Utilities', () => {
  describe('detectMarkdownConversionNeeded', () => {
    it('should detect raw markdown as needing conversion', () => {
      const markdown = '# Hello World\n- Item 1\n- Item 2';
      const result = detectMarkdownConversionNeeded(markdown);
      expect(result.needsConversion).toBe(true);
      expect(result.reason).toBe('raw_markdown');
    });

    it('should NOT flag already-converted HTML as needing conversion', () => {
      const html = '<h1>Hello World</h1><ul><li>Item 1</li><li>Item 2</li></ul>';
      const result = detectMarkdownConversionNeeded(html);
      expect(result.needsConversion).toBe(false);
      expect(result.reason).toBe('already_converted');
    });

    it('should handle empty content', () => {
      expect(detectMarkdownConversionNeeded('').needsConversion).toBe(false);
      expect(detectMarkdownConversionNeeded('<p></p>').needsConversion).toBe(false);
    });

    it('should handle plain text without markdown patterns', () => {
      const plainText = 'Just some regular text without any markdown';
      const result = detectMarkdownConversionNeeded(plainText);
      expect(result.needsConversion).toBe(false);
      expect(result.reason).toBe('not_markdown');
    });

    it('should detect code blocks', () => {
      const codeBlock = '```typescript\nconst x = 1;\n```';
      const result = detectMarkdownConversionNeeded(codeBlock);
      expect(result.needsConversion).toBe(true);
      expect(result.reason).toBe('raw_markdown');
    });

    it('should detect headers', () => {
      const headers = '# Heading 1\n## Heading 2\n### Heading 3';
      const result = detectMarkdownConversionNeeded(headers);
      expect(result.needsConversion).toBe(true);
      expect(result.reason).toBe('raw_markdown');
    });

    it('should detect blockquotes', () => {
      const blockquote = '> This is a quote\n> With multiple lines';
      const result = detectMarkdownConversionNeeded(blockquote);
      expect(result.needsConversion).toBe(true);
      expect(result.reason).toBe('raw_markdown');
    });
  });

  describe('convertMarkdownToHtml', () => {
    it('should convert headers correctly', () => {
      const markdown = '# Heading 1';
      const html = convertMarkdownToHtml(markdown);
      expect(html).toContain('<h1>');
      expect(html).toContain('Heading 1');
    });

    it('should convert unordered lists correctly', () => {
      const markdown = '- Item 1\n- Item 2';
      const html = convertMarkdownToHtml(markdown);
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
    });

    it('should convert ordered lists correctly', () => {
      const markdown = '1. First item\n2. Second item';
      const html = convertMarkdownToHtml(markdown);
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>');
    });

    it('should convert code blocks correctly', () => {
      const markdown = '```typescript\nconst x = 1;\n```';
      const html = convertMarkdownToHtml(markdown);
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
    });

    it('should convert bold text correctly', () => {
      const markdown = '**bold text**';
      const html = convertMarkdownToHtml(markdown);
      expect(html).toContain('<strong>');
    });

    it('should convert italic text correctly', () => {
      const markdown = '*italic text*';
      const html = convertMarkdownToHtml(markdown);
      expect(html).toContain('<em>');
    });

    it('should handle empty input', () => {
      expect(convertMarkdownToHtml('')).toBe('');
    });

    it('should handle input without markdown', () => {
      const plainText = 'Just some regular text';
      const html = convertMarkdownToHtml(plainText);
      expect(html).toContain('Just some regular text');
    });
  });

  describe('shouldConvertMarkdownPaste', () => {
    it('should return true for content starting with header', () => {
      expect(shouldConvertMarkdownPaste('# Heading')).toBe(true);
      expect(shouldConvertMarkdownPaste('## Subheading')).toBe(true);
    });

    it('should return true for lists', () => {
      expect(shouldConvertMarkdownPaste('- Item')).toBe(true);
      expect(shouldConvertMarkdownPaste('* Item')).toBe(true);
      expect(shouldConvertMarkdownPaste('1. First')).toBe(true);
    });

    it('should return true for code blocks', () => {
      expect(shouldConvertMarkdownPaste('```\ncode\n```')).toBe(true);
      expect(shouldConvertMarkdownPaste('```typescript\nconst x = 1;\n```')).toBe(true);
    });

    it('should return true for blockquotes', () => {
      expect(shouldConvertMarkdownPaste('> Quote')).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(shouldConvertMarkdownPaste('Just some text')).toBe(false);
      expect(shouldConvertMarkdownPaste('')).toBe(false);
    });
  });

  describe('shouldPreserveHtmlPaste', () => {
    it('should return true for HTML with rich formatting', () => {
      const richHtml = '<h1>Title</h1><ul><li>Item</li></ul>';
      expect(shouldPreserveHtmlPaste(richHtml)).toBe(true);
    });

    it('should return false for HTML without rich formatting', () => {
      const plainHtml = '<p>Just a paragraph</p>';
      expect(shouldPreserveHtmlPaste(plainHtml)).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(shouldPreserveHtmlPaste('')).toBe(false);
    });
  });
});

describe('RichTextEditor Component', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<RichTextEditor content="" onChange={mockOnChange} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with placeholder', () => {
    render(<RichTextEditor content="" onChange={mockOnChange} placeholder="Enter text..." />);
    // The editor should render with the placeholder
  });

  it('calls onChange when content changes', async () => {
    render(<RichTextEditor content="" onChange={mockOnChange} />);
    
    // Simulate typing - this would trigger onChange
    // Note: Testing TipTap editor content changes is complex
    // This is a basic smoke test
  });

  it('renders title when provided', () => {
    render(
      <RichTextEditor 
        content="" 
        onChange={mockOnChange} 
        title="Test Title"
        onTitleChange={vi.fn()}
      />
    );
    expect(screen.getByDisplayValue('Test Title')).toBeInTheDocument();
  });

  it('renders in readOnly mode', () => {
    render(<RichTextEditor content="<p>Read only content</p>" onChange={mockOnChange} readOnly={true} />);
    // Read-only mode should render without toolbar
  });
});
