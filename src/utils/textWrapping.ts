import { EditorView } from 'prosemirror-view';
import { Node, ResolvedPos } from 'prosemirror-model';

/**
 * Constants for text wrapping configuration
 */
export const WRAP_CHECK_DEBOUNCE_MS = 100;
export const AUTO_WRAP_RESET_DELAY_MS = 50;
export const SKIP_NODE_TYPES = ['codeBlock', 'table', 'tableRow', 'tableCell'] as const;

/**
 * Word information structure
 */
export interface WordInfo {
  wordStart: number;
  wordText: string;
}

/**
 * Style cache for text measurement performance optimization
 */
interface StyleCache {
  element: HTMLElement;
  styles: {
    font: string;
    fontSize: string;
    fontFamily: string;
    fontWeight: string;
    fontStyle: string;
    letterSpacing: string;
  };
}

// Global cache for measurement element and styles
let measurementElement: HTMLSpanElement | null = null;
const styleCache = new WeakMap<HTMLElement, StyleCache>();

/**
 * Get or create a cached measurement element with styles
 */
function getMeasurementElement(sourceElement: HTMLElement): HTMLSpanElement {
  if (!measurementElement) {
    measurementElement = document.createElement('span');
    measurementElement.style.visibility = 'hidden';
    measurementElement.style.position = 'absolute';
    measurementElement.style.left = '-9999px';
    measurementElement.style.whiteSpace = 'pre';
  }

  // Check if we have cached styles for this element
  let cached = styleCache.get(sourceElement);
  const computedStyle = window.getComputedStyle(sourceElement);
  
  const currentStyles = {
    font: computedStyle.font,
    fontSize: computedStyle.fontSize,
    fontFamily: computedStyle.fontFamily,
    fontWeight: computedStyle.fontWeight,
    fontStyle: computedStyle.fontStyle,
    letterSpacing: computedStyle.letterSpacing,
  };

  // Update cache if styles changed or not cached
  if (!cached || JSON.stringify(cached.styles) !== JSON.stringify(currentStyles)) {
    styleCache.set(sourceElement, {
      element: sourceElement,
      styles: currentStyles,
    });
    cached = styleCache.get(sourceElement)!;
  }

  // Apply cached styles to measurement element
  measurementElement.style.font = cached.styles.font;
  measurementElement.style.fontSize = cached.styles.fontSize;
  measurementElement.style.fontFamily = cached.styles.fontFamily;
  measurementElement.style.fontWeight = cached.styles.fontWeight;
  measurementElement.style.fontStyle = cached.styles.fontStyle;
  measurementElement.style.letterSpacing = cached.styles.letterSpacing;

  return measurementElement;
}

/**
 * Measure text width using a cached measurement element
 * Optimized to reuse DOM elements and cache styles
 */
export function measureTextWidth(element: HTMLElement, text: string): number {
  try {
    const tempSpan = getMeasurementElement(element);
    tempSpan.textContent = text;

    // Ensure element is in DOM for accurate measurement
    if (!tempSpan.parentElement) {
      document.body.appendChild(tempSpan);
    }

    const width = tempSpan.getBoundingClientRect().width;
    return width;
  } catch (error) {
    console.debug('Error measuring text width:', error);
    return 0;
  }
}

/**
 * Find the start position and text of the current word at the given position
 */
export function findWordStart(view: EditorView, pos: number): WordInfo | null {
  try {
    const { state } = view;
    const $pos = state.doc.resolve(pos);
    const parent = $pos.parent;

    // Get text content of the parent node
    const textContent = parent.textContent;
    const offsetInParent = $pos.parentOffset;

    // Find word start by going backward from cursor position
    let wordStart = offsetInParent;
    while (wordStart > 0 && /\S/.test(textContent[wordStart - 1])) {
      wordStart--;
    }

    // Find word end
    let wordEnd = offsetInParent;
    while (wordEnd < textContent.length && /\S/.test(textContent[wordEnd])) {
      wordEnd++;
    }

    if (wordStart >= wordEnd) {
      return null; // No word found
    }

    const wordText = textContent.substring(wordStart, wordEnd);

    // Calculate absolute position
    const parentStart = $pos.start($pos.depth);
    const wordStartPos = parentStart + wordStart;

    return { wordStart: wordStartPos, wordText };
  } catch (error) {
    console.debug('Error finding word start:', error);
    return null;
  }
}

/**
 * Find the paragraph DOM element for a given position
 * Caches lookups using WeakMap for performance
 */
const paragraphElementCache = new WeakMap<Node, HTMLElement | null>();

export function findParagraphElement(view: EditorView, pos: number): HTMLElement | null {
  try {
    const domAtPos = view.domAtPos(pos);
    if (!domAtPos || !domAtPos.node) {
      return null;
    }

    // Check cache first
    const cached = paragraphElementCache.get(domAtPos.node);
    if (cached !== undefined) {
      return cached;
    }

    let node: Node | null = domAtPos.node;

    // Find the paragraph element
    while (node && node.nodeType !== Node.ELEMENT_NODE) {
      node = node.parentNode;
    }

    if (node) {
      let current: HTMLElement | null = node as HTMLElement;
      while (current && current.tagName !== 'P' && current.tagName !== 'DIV') {
        current = current.parentElement;
      }

      // Cache the result
      paragraphElementCache.set(domAtPos.node, current);
      return current;
    }

    paragraphElementCache.set(domAtPos.node, null);
    return null;
  } catch (error) {
    console.debug('Error finding paragraph element:', error);
    return null;
  }
}

/**
 * Calculate available width for text in a container (accounting for padding)
 */
export function calculateAvailableWidth(paragraphElement: HTMLElement): number {
  try {
    const containerWidth = paragraphElement.offsetWidth;
    const computedStyle = window.getComputedStyle(paragraphElement);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    return containerWidth - paddingLeft - paddingRight;
  } catch (error) {
    console.debug('Error calculating available width:', error);
    return 0;
  }
}

/**
 * Find the start position of the current line (after the last hard break)
 */
export function findCurrentLineStart(view: EditorView, $from: ResolvedPos): number {
  try {
    let currentLineStart = $from.start($from.depth);
    let pos = $from.pos - 1;
    const { state } = view;

    while (pos >= currentLineStart) {
      const $pos = state.doc.resolve(pos);
      const node = $pos.nodeAfter;
      if (node && node.type.name === 'hardBreak') {
        currentLineStart = pos + 1; // Start of current line is after the break
        break;
      }
      pos--;
    }

    return currentLineStart;
  } catch (error) {
    console.debug('Error finding current line start:', error);
    return $from.start($from.depth);
  }
}

/**
 * Get text content before the word on the current line
 */
export function getTextBeforeWord(
  view: EditorView,
  currentLineStart: number,
  wordStart: number
): string {
  try {
    const { state } = view;
    if (wordStart <= currentLineStart) {
      return '';
    }

    const slice = state.doc.slice(currentLineStart, wordStart);
    return slice.content.textBetween(0, slice.content.size);
  } catch (error) {
    console.debug('Error getting text before word:', error);
    return '';
  }
}

/**
 * Find trailing whitespace before a word and return the position where it starts
 */
export function findTrailingWhitespaceStart(
  view: EditorView,
  currentLineStart: number,
  wordStart: number
): number {
  try {
    if (wordStart <= currentLineStart) {
      return wordStart;
    }

    const { state } = view;
    const slice = state.doc.slice(currentLineStart, wordStart);
    const textBefore = slice.content.textBetween(0, slice.content.size);
    
    // Find trailing whitespace
    const trailingWhitespaceMatch = textBefore.match(/\s+$/);
    if (trailingWhitespaceMatch) {
      const whitespaceLength = trailingWhitespaceMatch[0].length;
      return wordStart - whitespaceLength;
    }

    return wordStart;
  } catch (error) {
    console.debug('Error finding trailing whitespace:', error);
    return wordStart;
  }
}

/**
 * Check if wrapping should be skipped for the given parent node
 */
export function shouldSkipWrapping(parent: Node, paragraphElement: HTMLElement | null): boolean {
  // Don't wrap in code blocks, tables, or other special nodes
  if (SKIP_NODE_TYPES.includes(parent.type.name as typeof SKIP_NODE_TYPES[number])) {
    return true;
  }

  // Skip if paragraph is empty
  if (parent.textContent.trim().length === 0) {
    return true;
  }

  // Skip if we can't find the paragraph element
  if (!paragraphElement) {
    return true;
  }

  return false;
}

/**
 * Execute the word wrap operation
 */
export function executeWordWrap(
  view: EditorView,
  wordInfo: WordInfo,
  currentLineStart: number,
  originalCursorPos: number,
  onWrapComplete?: () => void
): void {
  try {
    const { state } = view;
    
    // Find where whitespace starts
    const whitespaceStart = findTrailingWhitespaceStart(view, currentLineStart, wordInfo.wordStart);
    let insertPos = wordInfo.wordStart;

    const tr = state.tr;

    // Remove trailing whitespace before the word if any
    if (whitespaceStart < insertPos) {
      tr.delete(whitespaceStart, insertPos);
      insertPos = whitespaceStart;
    }

    // Insert line break right before the word (after removing whitespace)
    tr.insert(insertPos, state.schema.nodes.hardBreak.create());

    // Calculate new cursor position
    const whitespaceRemoved = wordInfo.wordStart - insertPos;
    const newCursorPos = originalCursorPos - whitespaceRemoved + 1; // -whitespace + 1 for line break

    // Set cursor position at the end of the word (where user was typing)
    const newDoc = tr.doc;
    const newSelection = state.selection.constructor.create(newDoc, newCursorPos);
    tr.setSelection(newSelection);

    view.dispatch(tr);

    // Call completion callback if provided
    if (onWrapComplete) {
      onWrapComplete();
    }
  } catch (error) {
    console.debug('Error executing word wrap:', error);
  }
}

/**
 * Main function to check if word wrapping is needed and perform it
 */
export function checkAndWrapWord(
  view: EditorView,
  onWrapComplete?: () => void
): boolean {
  try {
    const { state } = view;
    const { selection } = state;
    const { $from } = selection;

    const parent = $from.parent;

    // Find paragraph element
    const paragraphElement = findParagraphElement(view, $from.pos);

    // Check if we should skip wrapping
    if (shouldSkipWrapping(parent, paragraphElement)) {
      return false;
    }

    // Calculate available width
    const availableWidth = calculateAvailableWidth(paragraphElement!);

    // Find current line start
    const currentLineStart = findCurrentLineStart(view, $from);

    // Find current word
    const wordInfo = findWordStart(view, $from.pos);
    if (!wordInfo || wordInfo.wordStart >= $from.pos) {
      return false;
    }

    // If word start is before current line start, we're already on a new line
    // Don't wrap again
    if (wordInfo.wordStart < currentLineStart) {
      return false;
    }

    // Get text before word on current line
    const textBeforeWord = getTextBeforeWord(view, currentLineStart, wordInfo.wordStart);

    // Measure the line width (text before word on current line + word)
    const lineText = textBeforeWord + wordInfo.wordText;
    const lineWidth = measureTextWidth(paragraphElement!, lineText);

    // Check if word would overflow the current line
    if (lineWidth > availableWidth) {
      executeWordWrap(view, wordInfo, currentLineStart, $from.pos, onWrapComplete);
      return true;
    }

    return false;
  } catch (error) {
    console.debug('Error in checkAndWrapWord:', error);
    return false;
  }
}
