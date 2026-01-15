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
 * Extracts text from a single TipTap node (recursive)
 * Stops at the first hardBreak to get only the first line
 */
function extractTextFromNode(node: any, stopAtHardBreak: boolean = false): string {
  if (!node) return '';
  
  if (node.type === 'text') {
    return node.text || '';
  }
  
  // Stop at hardBreak if we're extracting first line only
  if (stopAtHardBreak && node.type === 'hardBreak') {
    return '';
  }
  
  if (node.content && Array.isArray(node.content)) {
    let result = '';
    for (const child of node.content) {
      // Stop at first hardBreak
      if (stopAtHardBreak && child.type === 'hardBreak') {
        break;
      }
      result += extractTextFromNode(child, stopAtHardBreak);
    }
    return result;
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
  if (!content) return '';
  
  // Try to extract from TipTap JSON structure first (most accurate)
  let json: any = null;
  if (typeof content === 'object') {
    json = content;
  } else if (typeof content === 'string') {
    try {
      json = JSON.parse(content);
    } catch {
      // Not JSON, will fall back to text extraction
    }
  }
  
  // If it's TipTap JSON format, extract first paragraph directly
  if (json && json.type === 'doc' && json.content && Array.isArray(json.content)) {
    // Find the first paragraph or heading node that has actual text content
    for (const node of json.content) {
      if (['paragraph', 'heading'].includes(node.type)) {
        // Extract text from this node, stopping at first hardBreak (line break)
        let text = extractTextFromNode(node, true).trim();
        if (text) {
          // Safety: if text contains newlines, take only the first line
          const firstLine = text.split(/\n/)[0].trim();
          if (firstLine) {
            // Truncate to maxLength
            if (firstLine.length <= maxLength) return firstLine;
            return firstLine.substring(0, maxLength);
          }
        }
      }
    }
  }
  
  // Fallback: extract text and get first line
  const text = extractTextFromContent(content);
  
  if (!text) return '';
  
  // Get first line only - split by newline and take the first non-empty line
  // If no newline exists, the whole text is the first line
  const lines = text.split(/\n/);
  const firstLine = lines.find(line => line.trim().length > 0) || lines[0] || text;
  
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
