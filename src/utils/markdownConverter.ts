/**
 * Markdown Conversion Utility Module
 * 
 * Provides reliable markdown-to-HTML conversion with proper detection logic
 * to prevent duplicate conversions and ensure consistent content storage.
 */

import { marked } from 'marked';

/**
 * Result type for markdown conversion detection
 */
export interface ConversionDetectionResult {
  needsConversion: boolean;
  reason?: 'raw_markdown' | 'already_converted' | 'mixed_content_verified' | 'not_markdown';
}

/**
 * Result type for conversion validation
 */
export interface ConversionValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Extracts plain text from HTML, removing all tags
 */
function extractPlainText(html: string): string {
  if (!html) return '';
  
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
}

/**
 * Detects if content is raw markdown that needs conversion to HTML.
 * 
 * This function provides reliable detection by:
 * 1. Checking for existing HTML formatting (already converted)
 * 2. Checking for unconverted markdown patterns at line starts
 * 3. Distinguishing between raw markdown and mixed content
 * 
 * @param content - The content to check (HTML or markdown)
 * @returns Object indicating if conversion is needed and the reason
 */
export function detectMarkdownConversionNeeded(content: string): ConversionDetectionResult {
  if (!content || content.trim().length === 0) {
    return { needsConversion: false, reason: 'not_markdown' };
  }

  // Normalize content
  const normalizedContent = content.trim();

  // Check if already HTML with proper rich formatting
  // If content has substantial HTML structure, it's already converted
  const richTagPattern = /<(h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|a|table|thead|tbody|tr|th|td)[^>]*>/gi;
  const richTagMatches = normalizedContent.match(richTagPattern) || [];
  const hasSubstantialFormatting = richTagMatches.length >= 3;

  if (hasSubstantialFormatting) {
    // Check if text content also has markdown patterns that might be hidden
    // This is the key: extract pure text and check for UNCONVERTED patterns
    const plainText = extractPlainText(normalizedContent);
    
    // Only flag as "unconverted" if markdown patterns appear at LINE STARTS
    // This distinguishes raw markdown from content that just mentions markdown syntax
    const hasUnconvertedMarkdownPatterns = 
      /(^|\n)#{1,6}\s+\S/.test(plainText) ||      // Headers at line start
      /(^|\n)\s*[-*+]\s+\S/.test(plainText) ||    // Bullet lists at line start
      /(^|\n)\s*\d+\.\s+\S/.test(plainText) ||    // Numbered lists at line start
      /(^|\n)>\s/.test(plainText) ||              // Blockquotes at line start
      /```[\s\S]*?```/.test(plainText);           // Code blocks anywhere

    if (!hasUnconvertedMarkdownPatterns) {
      return { 
        needsConversion: false, 
        reason: 'already_converted' 
      };
    }
    
    // Has both HTML and markdown patterns - this is mixed content
    // The HTML is likely already rendered, so don't re-convert
    return { 
      needsConversion: false, 
      reason: 'mixed_content_verified' 
    };
  }

  // Check if content is pure markdown (no HTML tags)
  const hasAnyHtmlTags = /<[^>]+>/.test(normalizedContent);
  
  if (!hasAnyHtmlTags) {
    // Pure markdown - needs conversion
    const markdownPatterns = [
      /^#{1,6}\s/m,           // Headers at line start
      /^\s*[-*+]\s/m,         // Unordered lists at line start
      /^\s*\d+\.\s/m,         // Ordered lists at line start
      /^>\s/m,                // Blockquotes at line start
      /```[\s\S]*?```/m,       // Code blocks
      /\[([^\]]+)\]\(([^)]+)\)/m, // Links
      /\*\*[^*]+\*\*/m,        // Bold
      /\*[^*]+\*/m,            // Italic
    ];
    
    const hasMarkdownSyntax = markdownPatterns.some(p => p.test(normalizedContent));
    
    if (hasMarkdownSyntax) {
      return { needsConversion: true, reason: 'raw_markdown' };
    }
  }

  return { needsConversion: false, reason: 'not_markdown' };
}

/**
 * Normalizes code blocks from marked for TipTap compatibility.
 * Ensures code blocks have the correct structure for TipTap's CodeBlockLowlight extension.
 * 
 * TipTap's CodeBlockLowlight expects:
 * - <pre><code class="language-{lang}">content</code></pre>
 * - The code element must be a direct child of pre
 * - The language class must use the "language-" prefix
 * 
 * Uses DOMParser for reliable HTML parsing instead of regex.
 */
function normalizeCodeBlocksForTipTap(html: string): string {
  if (typeof document === 'undefined') {
    // Server-side: return as-is (shouldn't happen in browser environment)
    // If this is needed for SSR, consider using a library like cheerio
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
    
    // Always reconstruct the code block with clean structure
    // This ensures TipTap will parse it as a single code block
    // Clear any existing content and rebuild
    preElement.innerHTML = '';
    const newCodeElement = doc.createElement('code');
    newCodeElement.className = `language-${language}`;
    newCodeElement.textContent = codeContent; // Use textContent, not innerHTML
    preElement.appendChild(newCodeElement);
    
    // Ensure the pre element has no extra whitespace or text nodes
    // Remove any text nodes that might be siblings to the code element
    const childNodes = Array.from(preElement.childNodes);
    childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '') {
        preElement.removeChild(node);
      }
    });
  });
  
  // Return the normalized HTML from the body
  // This preserves the structure with headings, paragraphs, etc.
  return doc.body.innerHTML;
}

/**
 * Converts markdown string to HTML.
 * 
 * @param markdown - The markdown content to convert
 * @returns HTML string
 */
export function convertMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';

  try {
    const html = marked.parse(markdown, {
      breaks: false,
      gfm: true,
    }) as string;
    
    // Normalize code blocks for TipTap compatibility
    return normalizeCodeBlocksForTipTap(html);
  } catch (error) {
    console.warn('[MarkdownConverter] Failed to convert markdown:', error);
    return markdown; // Return original if conversion fails
  }
}

/**
 * Validates that converted HTML properly represents the original markdown structure.
 * Useful for debugging conversion issues.
 * 
 * @param originalMarkdown - The original markdown content
 * @param convertedHtml - The converted HTML content
 * @returns Object indicating if conversion was valid and any issues found
 */
export function validateConversion(
  originalMarkdown: string,
  convertedHtml: string
): ConversionValidationResult {
  const issues: string[] = [];
  
  if (!originalMarkdown || !convertedHtml) {
    return { valid: true, issues: [] };
  }

  // Check if all major markdown structures have HTML equivalents
  const plainText = extractPlainText(convertedHtml);
  
  const markdownCodeBlocks = (originalMarkdown.match(/```[\s\S]*?```/g) || []).length;
  const htmlCodeBlocks = (convertedHtml.match(/<pre[^>]*>[\s\S]*?<code[^>]*>/gi) || []).length;
  
  if (markdownCodeBlocks > 0 && htmlCodeBlocks === 0) {
    issues.push('Code blocks not properly converted');
  }
  
  const markdownHeaders = (originalMarkdown.match(/^#{1,6}\s+\S/mg) || []).length;
  const htmlHeaders = (convertedHtml.match(/<h[1-6][^>]*>[^<]+<\/h[1-6]>/gi) || []).length;
  
  if (markdownHeaders > 0 && htmlHeaders < markdownHeaders) {
    issues.push('Headers not properly converted');
  }
  
  const markdownLists = (originalMarkdown.match(/^\s*[-*+]\s+\S|^\s*\d+\.\s+\S/mg) || []).length;
  const htmlListItems = (convertedHtml.match(/<li[^>]*>/gi) || []).length;
  
  if (markdownLists > 0 && htmlListItems < markdownLists) {
    issues.push('List items not properly converted');
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Helper function to check if pasted content should be treated as markdown
 * Used by the paste handler for quick decision making
 * 
 * @param text - Plain text from clipboard
 * @returns true if the text should be converted from markdown
 */
export function shouldConvertMarkdownPaste(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  // Strict patterns that indicate markdown at line starts
  // This prevents false positives from text that mentions markdown syntax
  const strictMarkdownPatterns = [
    /^#{1,6}\s/m,           // Headers at line start
    /^\s*[-*+]\s/m,         // Unordered lists at line start
    /^\s*\d+\.\s/m,         // Ordered lists at line start
    /^>\s/m,                // Blockquotes at line start
    /```[\s\S]*?```/m,       // Code blocks (multi-line)
  ];

  // Check if text starts with any markdown pattern or has code blocks
  const trimmedText = text.trim();
  const hasStrictMarkdown = strictMarkdownPatterns.some(p => p.test(trimmedText));
  
  // Also check for code blocks anywhere in text
  const hasCodeBlocks = /```[\s\S]*?```/.test(text);

  return hasStrictMarkdown || hasCodeBlocks;
}

/**
 * Helper function to check if pasted HTML is rich content that should be preserved
 * 
 * @param html - HTML from clipboard
 * @returns true if the HTML should be used as-is
 */
export function shouldPreserveHtmlPaste(html: string): boolean {
  if (!html || html.trim().length === 0) return false;

  // Check for rich formatting tags
  const richTagCount = (html.match(/<(h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|a)[^>]*>/gi) || []).length;
  
  // If we have substantial rich formatting, preserve it
  return richTagCount >= 3;
}
