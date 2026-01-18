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

/**
 * Block node utilities for mapping ProseMirror positions to document content
 * These functions help locate and extract content using block positions
 */

/**
 * Parse document content to JSON format
 */
function parseDocContent(doc: any): any {
  if (!doc) return null;
  
  if (typeof doc === 'object' && doc.type === 'doc') {
    return doc;
  }
  
  if (typeof doc === 'string') {
    try {
      const parsed = JSON.parse(doc);
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  
  return null;
}

/**
 * Get block node at a specific ProseMirror position
 * @param doc - Document content (TipTap JSON format)
 * @param blockPos - Block start position in ProseMirror document
 * @returns Block node object or null if not found
 */
export function getBlockNodeByPosition(doc: any, blockPos: number): any | null {
  const docJson = parseDocContent(doc);
  if (!docJson || !docJson.content) return null;

  try {
    // Traverse document to find node at position
    let currentPos = 1; // Start after doc opening (position 0 is before doc, 1 is after)
    
    const traverse = (nodes: any[]): any | null => {
      for (const node of nodes) {
        const nodeSize = getNodeSize(node);
        const nodeStart = currentPos;
        const nodeEnd = currentPos + nodeSize;
        
        // Check if blockPos is within this node
        if (blockPos >= nodeStart && blockPos < nodeEnd) {
          // Check if this is a block-level node
          if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableCell', 'tableHeader'].includes(node.type)) {
            return node;
          }
          
          // If node has content, traverse deeper
          if (node.content && Array.isArray(node.content)) {
            currentPos += 1; // Account for node opening
            const result = traverse(node.content);
            if (result) return result;
            currentPos += nodeSize - 1; // Skip to after node
          } else {
            currentPos = nodeEnd;
          }
        } else {
          currentPos = nodeEnd;
        }
      }
      
      return null;
    };
    
    return traverse(docJson.content);
  } catch (error) {
    console.debug('Error getting block node by position:', error);
    return null;
  }
}

/**
 * Calculate the size of a node (including all its children)
 */
function getNodeSize(node: any): number {
  if (!node) return 0;
  
  // Text nodes contribute their text length
  if (node.type === 'text') {
    return (node.text || '').length;
  }
  
  // Other nodes contribute 1 (opening) + content + 1 (closing)
  let size = 2; // Opening and closing
  
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) {
      size += getNodeSize(child);
    }
  }
  
  return size;
}

/**
 * Extract text from a block node at a specific position
 * @param doc - Document content (TipTap JSON format)
 * @param blockPos - Block start position
 * @param from - Optional: start offset within block (default: 0)
 * @param to - Optional: end offset within block (default: end of block)
 * @returns Text content from the block node
 */
export function getTextByBlockPosition(
  doc: any,
  blockPos: number,
  from?: number,
  to?: number
): string {
  const blockNode = getBlockNodeByPosition(doc, blockPos);
  if (!blockNode) return '';
  
  const blockText = extractTextFromNode(blockNode);
  
  if (from === undefined && to === undefined) {
    return blockText;
  }
  
  const start = from || 0;
  const end = to !== undefined ? to : blockText.length;
  
  return blockText.substring(start, end);
}

/**
 * Get block node information (type, content, metadata)
 * @param doc - Document content (TipTap JSON format)
 * @param blockPos - Block start position
 * @returns Block node information object or null
 */
export function getBlockNodeInfo(doc: any, blockPos: number): {
  type: string;
  content: string;
  attrs?: any;
  node: any;
} | null {
  const blockNode = getBlockNodeByPosition(doc, blockPos);
  if (!blockNode) return null;
  
  return {
    type: blockNode.type,
    content: extractTextFromNode(blockNode),
    attrs: blockNode.attrs || {},
    node: blockNode,
  };
}
