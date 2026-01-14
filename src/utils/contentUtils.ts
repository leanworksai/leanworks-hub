/**
 * Utility functions for extracting text from document content
 * Handles both TipTap JSON format and legacy HTML format
 */

/**
 * Extracts plain text from TipTap JSON structure
 */
function extractTextFromJSON(json: any): string {
  if (!json || !json.content) return '';
  let text = '';
  
  const traverse = (node: any) => {
    if (node.type === 'text') {
      text += node.text || '';
      // Add newline after text nodes that are followed by block elements
      if (node.text && !node.text.endsWith('\n')) {
        // Check if this is the last text node in a block
        text += ' ';
      }
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child: any) => {
        traverse(child);
        // Add newline after block-level nodes
        if (['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem'].includes(child.type)) {
          text += '\n';
        }
      });
    }
  };
  
  traverse(json);
  return text.trim();
}

/**
 * Extracts text from content (handles both JSON and HTML formats)
 */
export function extractTextFromContent(content: string | object): string {
  if (!content) return '';
  
  if (typeof content === 'object') {
    // TipTap JSON format
    return extractTextFromJSON(content);
  }
  
  if (typeof content === 'string') {
    try {
      // Try to parse as JSON first
      const json = JSON.parse(content);
      if (json && typeof json === 'object' && json.type === 'doc') {
        return extractTextFromJSON(json);
      }
    } catch {
      // Not JSON, treat as HTML (legacy format)
    }
    
    // HTML format (legacy) - remove tags and decode entities
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    return tempDiv.textContent || tempDiv.innerText || '';
  }
  
  return '';
}

/**
 * Extracts the first line from content for use as title
 * @param content - Document content (JSON object, JSON string, or HTML string)
 * @param maxLength - Maximum length for the title (default: 100 for DB storage)
 * @returns First line of text, truncated to maxLength
 */
export function extractFirstLineAsTitle(
  content: string | object,
  maxLength: number = 100
): string {
  const text = extractTextFromContent(content);
  
  if (!text) return '';
  
  // Get first line - split by newline, period followed by space, or take first sentence
  const firstLine = text
    .split(/\n/)
    .find(line => line.trim().length > 0) || 
    text.split(/\.\s+/)[0] ||
    text;
  
  const trimmed = firstLine.trim();
  
  // Truncate to maxLength
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.substring(0, maxLength);
}

/**
 * Gets preview text (content excluding first line)
 * @param content - Document content
 * @param maxLength - Maximum length for preview (default: 150)
 * @returns Preview text without first line
 */
export function getPreviewText(
  content: string | object,
  maxLength: number = 150
): string {
  const text = extractTextFromContent(content);
  
  if (!text) return '';
  
  // Split into lines
  const lines = text.split(/\n/).filter(line => line.trim().length > 0);
  
  // Remove first line (title)
  const remainingLines = lines.slice(1).join(' ').trim();
  
  if (!remainingLines) return '';
  
  // Truncate to maxLength
  if (remainingLines.length <= maxLength) return remainingLines;
  return remainingLines.substring(0, maxLength) + '...';
}
