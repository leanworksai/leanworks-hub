import { useState, useEffect, useRef, RefObject } from 'react';

export interface TextSelectionPosition {
  docId: string;
  startOffset: number;
  endOffset: number;
  text?: string; // The actual selected text content
}

export interface UseTextSelectionResult {
  selectedText: string;
  hasSelection: boolean;
  selectionBounds: DOMRect | null;
  selectionPosition: TextSelectionPosition | null;
}

/**
 * Hook to detect text selection within a specific container element
 * Returns the selected text, whether there's a selection, the selection bounds, and position info
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement>,
  editorRef: RefObject<any>, // TipTap editor ref
  docId?: string
): UseTextSelectionResult {
  const [selectedText, setSelectedText] = useState<string>('');
  const [hasSelection, setHasSelection] = useState<boolean>(false);
  const [selectionBounds, setSelectionBounds] = useState<DOMRect | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<TextSelectionPosition | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleSelectionChange = () => {
      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Debounce selection changes to avoid excessive updates
      timeoutRef.current = setTimeout(() => {
        const selection = window.getSelection();
        
        if (!selection || selection.rangeCount === 0) {
          setSelectedText('');
          setHasSelection(false);
          setSelectionBounds(null);
          setSelectionPosition(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const container = containerRef.current;

        // Check if selection is within the container
        if (!container || range.collapsed) {
          setSelectedText('');
          setHasSelection(false);
          setSelectionBounds(null);
          setSelectionPosition(null);
          return;
        }

        // Check if the selection is within our container
        const containerRect = container.getBoundingClientRect();
        const rangeRect = range.getBoundingClientRect();

        // Check if range intersects with container
        const isWithinContainer = 
          rangeRect.top >= containerRect.top &&
          rangeRect.left >= containerRect.left &&
          rangeRect.bottom <= containerRect.bottom &&
          rangeRect.right <= containerRect.right;

        // Also check if the common ancestor is within our container
        const commonAncestor = range.commonAncestorContainer;
        const isAncestorInContainer = container.contains(
          commonAncestor.nodeType === Node.TEXT_NODE 
            ? commonAncestor.parentElement 
            : commonAncestor as Node
        );

        if (!isWithinContainer && !isAncestorInContainer) {
          setSelectedText('');
          setHasSelection(false);
          setSelectionBounds(null);
          setSelectionPosition(null);
          return;
        }

        // Get selected text and trim whitespace
        const text = range.toString().trim();

        // Don't show button for empty or whitespace-only selections
        if (!text || text.length === 0) {
          setSelectedText('');
          setHasSelection(false);
          setSelectionBounds(null);
          setSelectionPosition(null);
          return;
        }

        // Try to get TipTap editor positions if editor is available
        let position: TextSelectionPosition | null = null;
        const editor = editorRef.current;
        if (editor && docId && editor.view) {
          try {
            const startNode = range.startContainer;
            const endNode = range.endContainer;
            const startOffset = range.startOffset;
            const endOffset = range.endOffset;

            // Convert DOM positions to TipTap positions
            const startPos = editor.view.posAtDOM(startNode, startOffset);
            const endPos = editor.view.posAtDOM(endNode, endOffset);

            if (startPos !== null && endPos !== null && startPos >= 0 && endPos >= 0) {
              position = {
                docId,
                startOffset: startPos,
                endOffset: endPos,
                text: text, // Include the actual selected text
              };
            }
          } catch (error) {
            // If position calculation fails, we'll just use text
            console.debug('Failed to calculate editor positions:', error);
          }
        }

        setSelectedText(text);
        setHasSelection(true);
        setSelectionBounds(range.getBoundingClientRect());
        setSelectionPosition(position);
      }, 100); // 100ms debounce
    };

    // Listen for selection changes
    document.addEventListener('selectionchange', handleSelectionChange);

    // Also listen for mouseup to catch selection end
    document.addEventListener('mouseup', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleSelectionChange);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [containerRef, editorRef, docId]);

  return {
    selectedText,
    hasSelection,
    selectionBounds,
    selectionPosition,
  };
}
