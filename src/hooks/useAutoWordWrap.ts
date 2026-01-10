import { useRef, useEffect, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { EditorView } from 'prosemirror-view';
import { checkAndWrapWord, WRAP_CHECK_DEBOUNCE_MS, AUTO_WRAP_RESET_DELAY_MS } from '@/utils/textWrapping';

/**
 * Custom hook for handling automatic word wrapping at boundaries
 * Manages state and event handlers for auto-wrap functionality
 */
export function useAutoWordWrap(editor: Editor | null) {
  // State tracking refs
  const isAutoWrappingRef = useRef<boolean>(false);
  const lastCheckedPositionRef = useRef<number>(-1);
  const wrapCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Mobile detection
  const isMobile = useRef<boolean>(
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );

  /**
   * Handle wrap completion callback
   * Resets position tracking so next input can be checked
   */
  const handleWrapComplete = useCallback(() => {
    lastCheckedPositionRef.current = -1;
  }, []);

  /**
   * Perform the wrap check with proper debouncing and state management
   */
  const performWrapCheck = useCallback(
    (view: EditorView) => {
      if (isAutoWrappingRef.current || !editor) {
        return;
      }

      const { state } = view;
      const { selection } = state;
      const currentPos = selection.$from.pos;

      // Skip if we already checked this position
      if (lastCheckedPositionRef.current === currentPos) {
        return;
      }

      lastCheckedPositionRef.current = currentPos;
      isAutoWrappingRef.current = true;

      try {
        checkAndWrapWord(view, handleWrapComplete);
      } finally {
        // Reset flag after a short delay
        setTimeout(() => {
          isAutoWrappingRef.current = false;
        }, AUTO_WRAP_RESET_DELAY_MS);
      }
    },
    [editor, handleWrapComplete]
  );

  /**
   * Handle input events with debouncing
   */
  const handleInput = useCallback(
    (view: EditorView, event: Event): boolean => {
      // Skip if already auto-wrapping to prevent loops
      if (isAutoWrappingRef.current) {
        return false;
      }

      // Skip for non-text input (e.g., composition events, special keys)
      const inputEvent = event as InputEvent;
      if (
        inputEvent.inputType === 'insertCompositionText' ||
        inputEvent.inputType === 'deleteCompositionText'
      ) {
        return false;
      }

      // Debounce: Clear existing timeout
      if (wrapCheckTimeoutRef.current) {
        clearTimeout(wrapCheckTimeoutRef.current);
      }

      // Check after a short delay to allow DOM to update
      wrapCheckTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          performWrapCheck(view);
        });
      }, WRAP_CHECK_DEBOUNCE_MS);

      return false; // Don't prevent default
    },
    [performWrapCheck]
  );

  /**
   * Handle composition end events (for IME input)
   */
  const handleCompositionEnd = useCallback(
    (view: EditorView, event: Event): boolean => {
      // After composition ends, check if wrapping is needed
      if (wrapCheckTimeoutRef.current) {
        clearTimeout(wrapCheckTimeoutRef.current);
      }

      wrapCheckTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          performWrapCheck(view);
        });
      }, WRAP_CHECK_DEBOUNCE_MS);

      return false;
    },
    [performWrapCheck]
  );

  /**
   * Handle touch end events for mobile devices
   */
  const handleTouchEnd = useCallback(
    (view: EditorView, event: Event): boolean => {
      // On mobile, trigger wrap check after touch input with longer delay
      // to account for virtual keyboard and text prediction
      if (wrapCheckTimeoutRef.current) {
        clearTimeout(wrapCheckTimeoutRef.current);
      }

      wrapCheckTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          performWrapCheck(view);
        });
      }, WRAP_CHECK_DEBOUNCE_MS * 2); // Longer delay for mobile

      return false;
    },
    [performWrapCheck]
  );

  /**
   * Handle blur events for mobile (when user finishes editing)
   */
  const handleBlur = useCallback(
    (view: EditorView, event: Event): boolean => {
      // On mobile, check wrapping when user leaves the input field
      if (wrapCheckTimeoutRef.current) {
        clearTimeout(wrapCheckTimeoutRef.current);
      }

      wrapCheckTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          performWrapCheck(view);
        });
      }, WRAP_CHECK_DEBOUNCE_MS);

      return false;
    },
    [performWrapCheck]
  );

  /**
   * Set up mobile-specific event listeners
   */
  useEffect(() => {
    if (!editor || !isMobile.current) return;

    const view = editor.view;
    if (!view) return;

    // Add mobile-specific event listeners
    const dom = view.dom;
    dom.addEventListener('touchend', (e) => handleTouchEnd(view, e as any));
    dom.addEventListener('blur', (e) => handleBlur(view, e as any));

    return () => {
      dom.removeEventListener('touchend', (e) => handleTouchEnd(view, e as any));
      dom.removeEventListener('blur', (e) => handleBlur(view, e as any));
    };
  }, [editor, handleTouchEnd, handleBlur]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (wrapCheckTimeoutRef.current) {
        clearTimeout(wrapCheckTimeoutRef.current);
      }
    };
  }, []);

  return {
    handleInput,
    handleCompositionEnd,
    // Mobile-specific handlers (available for manual attachment if needed)
    handleTouchEnd,
    handleBlur,
  };
}
