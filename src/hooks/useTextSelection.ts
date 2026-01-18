import { useState, useEffect, useRef, RefObject } from 'react';

export interface TextSelectionPosition {
  docId: string;
  // ProseMirror positions (primary)
  from: number;
  to: number;
  // Block node information (stable reference)
  blockType: string; // paragraph, heading, listItem, blockquote, codeBlock, etc.
  blockPos: number; // Block start position
  blockOffset: number; // Offset within block
  // Legacy fields for backward compatibility
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
 * Find the closest block-level node containing the selection
 * Block nodes: paragraph, heading, listItem, blockquote, codeBlock
 */
function findBlockNode($from: any): { node: any; depth: number; blockPos: number } | null {
  let depth = $from.depth;
  
  // Walk up the node tree to find block node
  while (depth > 0) {
    const node = $from.node(depth);
    const nodeType = node.type.name;
    
    // Check if this is a block-level node
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableCell', 'tableHeader'].includes(nodeType)) {
      const blockPos = $from.start(depth);
      return { node, depth, blockPos };
    }
    
    depth--;
  }
  
  // If no block node found, use the document root
  return null;
}

/**
 * Validates if a DOMRect is reasonable and usable
 * Checks for positive dimensions and reasonable positioning
 */
function isValidBounds(bounds: DOMRect | null): boolean {
  if (!bounds) return false;
  
  // Must have positive dimensions
  if (bounds.width <= 0 || bounds.height <= 0) {
    if (import.meta.env.DEV) {
      console.debug('[useTextSelection] Invalid bounds: zero dimensions', { width: bounds.width, height: bounds.height });
    }
    return false;
  }
  
  // Position should be within reasonable viewport range
  // Allow negative top/left for elements partially off-screen, but not too far
  if (bounds.top < -1000 || bounds.left < -1000) {
    if (import.meta.env.DEV) {
      console.debug('[useTextSelection] Invalid bounds: position too far off-screen', { top: bounds.top, left: bounds.left });
    }
    return false;
  }
  
  return true;
}

/**
 * Layer 1: Get selection bounds from native DOM Selection API
 * Most reliable as it uses the actual rendered DOM
 */
function getDOMSelectionBounds(editorDOM: HTMLElement): DOMRect | null {
  try {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 1: No DOM selection found');
      }
      return null;
    }
    
    const range = selection.getRangeAt(0);
    
    // Verify selection is within editor
    if (!editorDOM.contains(range.commonAncestorContainer)) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 1: Selection not within editor');
      }
      return null;
    }
    
    const bounds = range.getBoundingClientRect();
    
    if (isValidBounds(bounds)) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 1 SUCCESS: DOM selection bounds', { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height });
      }
      return bounds;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('[useTextSelection] Layer 1 FAILED: DOM selection error:', error);
    }
  }
  
  return null;
}

/**
 * Layer 2: Get selection bounds from TipTap view.domAtPos()
 * Converts ProseMirror positions to DOM nodes
 */
function getTipTapViewBounds(editor: any, from: number, to: number): DOMRect | null {
  try {
    const { view } = editor;
    if (!view || !view.dom) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 2: No TipTap view available');
      }
      return null;
    }
    
    // Get DOM positions for selection start and end
    const startDOM = view.domAtPos(from);
    const endDOM = view.domAtPos(to);
    
    // Validate both positions exist
    if (!startDOM.node || !endDOM.node) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 2: Invalid DOM positions', { hasStart: !!startDOM.node, hasEnd: !!endDOM.node });
      }
      return null;
    }
    
    // Create range from start to end
    const range = document.createRange();
    range.setStart(startDOM.node, startDOM.offset);
    range.setEnd(endDOM.node, endDOM.offset);
    
    const bounds = range.getBoundingClientRect();
    
    if (isValidBounds(bounds)) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 2 SUCCESS: TipTap view bounds', { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height });
      }
      return bounds;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('[useTextSelection] Layer 2 FAILED: TipTap view error:', error);
    }
  }
  
  return null;
}

/**
 * Layer 3: Calculate bounds from block node information
 * Uses ProseMirror state to estimate position
 */
function getBlockNodeBounds(editor: any, blockPos: number, containerRef: RefObject<HTMLElement>): DOMRect | null {
  try {
    const { view } = editor;
    if (!view || !view.dom) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 3: No TipTap view available');
      }
      return null;
    }
    
    // Get DOM position of block start
    const blockDOM = view.domAtPos(blockPos);
    if (!blockDOM.node) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 3: Invalid block DOM position');
      }
      return null;
    }
    
    // Get bounding rect of the block node
    let blockElement = blockDOM.node as HTMLElement;
    
    // If it's a text node, get its parent element
    if (blockElement.nodeType === Node.TEXT_NODE) {
      blockElement = blockElement.parentElement as HTMLElement;
    }
    
    if (!blockElement) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 3: Could not get block element');
      }
      return null;
    }
    
    const bounds = blockElement.getBoundingClientRect();
    
    if (isValidBounds(bounds)) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 3 SUCCESS: Block node bounds', { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height });
      }
      return bounds;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('[useTextSelection] Layer 3 FAILED: Block node error:', error);
    }
  }
  
  return null;
}

/**
 * Layer 4: Fallback to container center position
 * Last resort - ensures button is at least visible
 */
function getContainerCenterBounds(containerRef: RefObject<HTMLElement>): DOMRect | null {
  try {
    if (!containerRef.current) {
      if (import.meta.env.DEV) {
        console.debug('[useTextSelection] Layer 4: No container ref available');
      }
      return null;
    }
    
    const containerRect = containerRef.current.getBoundingClientRect();
    
    // Create a DOMRect at the center of the container
    // Use a reasonable size for the button area
    const bounds = new DOMRect(
      containerRect.left + containerRect.width / 2 - 50,  // Center horizontally
      containerRect.top + 50,  // Position near top of container
      100,  // Width
      20    // Height
    );
    
    if (isValidBounds(bounds)) {
      if (import.meta.env.DEV) {
        console.log('[useTextSelection] Layer 4 FALLBACK: Container center bounds', { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height });
      }
      return bounds;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('[useTextSelection] Layer 4 FAILED: Container center error:', error);
    }
  }
  
  return null;
}

/**
 * Multi-layered selection bounds calculation
 * Tries multiple strategies in order of reliability
 */
function calculateSelectionBounds(
  editor: any,
  from: number,
  to: number,
  blockPos: number,
  containerRef: RefObject<HTMLElement>
): DOMRect | null {
  if (import.meta.env.DEV) {
    console.log('[useTextSelection] Starting bounds calculation with 4 layers...', { from, to, blockPos });
  }
  
  // Layer 1: Native DOM Selection (Most Reliable)
  if (editor?.view?.dom) {
    const domBounds = getDOMSelectionBounds(editor.view.dom);
    if (domBounds) {
      if (import.meta.env.DEV) {
        console.log('[useTextSelection] ✓ Layer 1 SUCCESS - Using DOM selection bounds');
      }
      return domBounds;
    }
  } else {
    if (import.meta.env.DEV) {
      console.debug('[useTextSelection] Layer 1 SKIPPED - No editor view DOM');
    }
  }
  
  // Layer 2: TipTap View Position Conversion
  const tipTapBounds = getTipTapViewBounds(editor, from, to);
  if (tipTapBounds) {
    if (import.meta.env.DEV) {
      console.log('[useTextSelection] ✓ Layer 2 SUCCESS - Using TipTap view bounds');
    }
    return tipTapBounds;
  }
  
  // Layer 3: Block Node Calculation
  const blockBounds = getBlockNodeBounds(editor, blockPos, containerRef);
  if (blockBounds) {
    if (import.meta.env.DEV) {
      console.log('[useTextSelection] ✓ Layer 3 SUCCESS - Using block node bounds');
    }
    return blockBounds;
  }
  
  // Layer 4: Container Center (Last Resort)
  const containerBounds = getContainerCenterBounds(containerRef);
  if (containerBounds) {
    if (import.meta.env.DEV) {
      console.log('[useTextSelection] ⚠ Layer 4 FALLBACK - Using container center bounds (may not be accurate)');
    }
    return containerBounds;
  }
  
  if (import.meta.env.DEV) {
    console.error('[useTextSelection] ✗ CRITICAL: All bounds calculation layers failed!', {
      from,
      to,
      blockPos,
      hasEditor: !!editor,
      hasEditorView: !!editor?.view,
      hasEditorViewDom: !!editor?.view?.dom,
      hasContainerRef: !!containerRef.current,
      containerRefBounds: containerRef.current?.getBoundingClientRect()
    });
  }
  
  return null;
}

/**
 * Hook to detect text selection within a TipTap editor
 * Uses ProseMirror state instead of DOM selection for position stability
 * Returns the selected text, whether there's a selection, the selection bounds, and position info
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement>,
  editor: any | null, // TipTap editor instance
  docId?: string
): UseTextSelectionResult {
  const [selectedText, setSelectedText] = useState<string>('');
  const [hasSelection, setHasSelection] = useState<boolean>(false);
  const [selectionBounds, setSelectionBounds] = useState<DOMRect | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<TextSelectionPosition | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[useTextSelection] useEffect triggered:', {
        hasEditor: !!editor,
        hasDocId: !!docId,
        editorIsDestroyed: editor?.isDestroyed,
        editorHasView: !!editor?.view
      });
    }
    
    if (!editor || !docId) {
      if (import.meta.env.DEV) {
        console.warn('[useTextSelection] Missing editor or docId, clearing selection state');
      }
      setSelectedText('');
      setHasSelection(false);
      setSelectionBounds(null);
      setSelectionPosition(null);
      lastSelectionRef.current = null;
      return;
    }

    const handleSelectionChange = () => {
      if (import.meta.env.DEV) {
        console.log('[useTextSelection] handleSelectionChange called');
      }
      
      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Debounce selection changes to avoid excessive updates
      timeoutRef.current = setTimeout(() => {
        try {
          const { state } = editor;
          const { from, to, $from } = state.selection;

          // Debug logging (only in dev)
          if (import.meta.env.DEV) {
            console.log('[useTextSelection] Selection changed:', { from, to, docId });
          }

          // Check if selection actually changed
          const lastSelection = lastSelectionRef.current;
          if (lastSelection && lastSelection.from === from && lastSelection.to === to) {
            // Selection hasn't changed, skip processing
            if (import.meta.env.DEV) {
              console.log('[useTextSelection] Selection unchanged, skipping');
            }
            return;
          }
          lastSelectionRef.current = { from, to };

          // Check if there's a valid selection (not collapsed)
          if (from === to) {
            if (import.meta.env.DEV) {
              console.log('[useTextSelection] Collapsed selection, clearing');
            }
            setSelectedText('');
            setHasSelection(false);
            setSelectionBounds(null);
            setSelectionPosition(null);
            return;
          }

          // Get selected text from ProseMirror state
          const text = state.doc.textBetween(from, to).trim();

          // Don't show button for empty or whitespace-only selections
          if (!text || text.length === 0) {
            if (import.meta.env.DEV) {
              console.log('[useTextSelection] Empty text selection, clearing');
            }
            setSelectedText('');
            setHasSelection(false);
            setSelectionBounds(null);
            setSelectionPosition(null);
            return;
          }

          if (import.meta.env.DEV) {
            console.log('[useTextSelection] Valid selection detected:', { text: text.substring(0, 50), from, to });
          }

          // Find the closest block node containing the selection
          const blockInfo = findBlockNode($from);
          
          if (!blockInfo) {
            // Fallback: use parent node
            if (import.meta.env.DEV) {
              console.debug('[useTextSelection] No block node found, using parent node fallback');
            }
            
            const blockNode = $from.parent;
            const blockPos = $from.start($from.depth);
            const blockOffset = $from.parentOffset;

            // Get selection bounds using multi-layered calculation strategy
            const bounds = calculateSelectionBounds(editor, from, to, blockPos, containerRef);

            const position: TextSelectionPosition = {
              docId,
              from,
              to,
              blockType: blockNode.type.name,
              blockPos,
              blockOffset,
              startOffset: from, // Legacy
              endOffset: to, // Legacy
              text,
            };

            setSelectedText(text);
            setHasSelection(true);
            setSelectionBounds(bounds);
            setSelectionPosition(position);
            
            if (import.meta.env.DEV) {
              const shouldShowAskAI = !!bounds && !!position && text.length > 0;
              console.log('[useTextSelection] Fallback selection state updated:', {
                hasSelection: true,
                textLength: text.length,
                selectedText: text.substring(0, 50),
                hasBounds: !!bounds,
                hasPosition: !!position,
                shouldShowAskAI,
                boundsDetails: bounds ? {
                  top: bounds.top,
                  left: bounds.left,
                  width: bounds.width,
                  height: bounds.height
                } : 'NO BOUNDS - Ask AI will NOT show',
                blockType: blockNode.type.name
              });
              
              if (!shouldShowAskAI) {
                console.warn('[useTextSelection] ⚠ Ask AI will NOT be triggered (fallback path):', {
                  reason: !bounds ? 'Missing bounds' : !position ? 'Missing position' : 'Unknown',
                  bounds: !!bounds,
                  position: !!position,
                  textLength: text.length
                });
              }
            }
            return;
          }

          const { node: blockNode, depth: blockDepth, blockPos } = blockInfo;
          const blockOffset = $from.parentOffset;

          // Get selection bounds using multi-layered calculation strategy
          // This ensures we always get a valid position for the floating button
          const bounds = calculateSelectionBounds(editor, from, to, blockPos, containerRef);

          const position: TextSelectionPosition = {
            docId,
            from,
            to,
            blockType: blockNode.type.name,
            blockPos,
            blockOffset,
            startOffset: from, // Legacy compatibility
            endOffset: to, // Legacy compatibility
            text,
          };

          setSelectedText(text);
          setHasSelection(true);
          setSelectionBounds(bounds);
          setSelectionPosition(position);
          
          if (import.meta.env.DEV) {
            const shouldShowAskAI = !!bounds && !!position && text.length > 0;
            console.log('[useTextSelection] Selection state updated:', {
              hasSelection: true,
              textLength: text.length,
              selectedText: text.substring(0, 50),
              hasBounds: !!bounds,
              hasPosition: !!position,
              shouldShowAskAI,
              boundsDetails: bounds ? {
                top: bounds.top,
                left: bounds.left,
                width: bounds.width,
                height: bounds.height
              } : 'NO BOUNDS - Ask AI will NOT show',
              positionDetails: position ? {
                from: position.from,
                to: position.to,
                blockType: position.blockType,
                blockPos: position.blockPos
              } : 'NO POSITION'
            });
            
            if (!shouldShowAskAI) {
              console.warn('[useTextSelection] ⚠ Ask AI will NOT be triggered:', {
                reason: !bounds ? 'Missing bounds' : !position ? 'Missing position' : 'Unknown',
                bounds: !!bounds,
                position: !!position,
                textLength: text.length
              });
            }
          }
        } catch (error) {
          // If selection processing fails, clear state
          console.error('[useTextSelection] Failed to process selection:', error);
          setSelectedText('');
          setHasSelection(false);
          setSelectionBounds(null);
          setSelectionPosition(null);
        }
      }, 100); // 100ms debounce
    };

    // Listen to TipTap's update event (fires on transactions including selection changes)
    if (import.meta.env.DEV) {
      console.log('[useTextSelection] Registering editor.on("update") listener');
    }
    editor.on('update', handleSelectionChange);
    editor.on('selectionUpdate', handleSelectionChange);
    
    // Also listen to DOM selection changes as a fallback
    // Note: This is defined after handleSelectionChange so it can reference it
    const handleDOMSelectionChange = () => {
      // Only process if there's an actual DOM selection
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) {
        return;
      }
      
      // Check if selection is within the editor
      try {
        const range = domSelection.getRangeAt(0);
        const editorDOM = editor.view.dom;
        if (!editorDOM.contains(range.commonAncestorContainer)) {
          return;
        }
        
        // Trigger the selection handler
        handleSelectionChange();
      } catch (error) {
        // Ignore errors from DOM selection access
        if (import.meta.env.DEV) {
          console.debug('[useTextSelection] DOM selection check failed:', error);
        }
      }
    };
    
    document.addEventListener('selectionchange', handleDOMSelectionChange);

    return () => {
      if (editor && !editor.isDestroyed) {
        editor.off('update', handleSelectionChange);
        editor.off('selectionUpdate', handleSelectionChange);
      }
      document.removeEventListener('selectionchange', handleDOMSelectionChange);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      lastSelectionRef.current = null;
    };
  }, [containerRef, editor, docId]);

  return {
    selectedText,
    hasSelection,
    selectionBounds,
    selectionPosition,
  };
}
