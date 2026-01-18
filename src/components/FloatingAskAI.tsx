import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TextSelectionPosition } from '@/hooks/useTextSelection';

interface FloatingAskAIProps {
  visible: boolean;
  position: DOMRect | null;
  containerBounds?: DOMRect | null;
  onAskAI: (selectionPosition: TextSelectionPosition) => void;
  selectionPosition: TextSelectionPosition | null;
  selectedText: string; // Keep for display purposes
}

export function FloatingAskAI({ visible, position, containerBounds, onAskAI, selectionPosition, selectedText }: FloatingAskAIProps) {
  const [buttonPosition, setButtonPosition] = useState<{ top: number; left: number } | null>(null);

  // Debug logging
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[FloatingAskAI] Props:', {
        visible,
        hasPosition: !!position,
        hasSelectionPosition: !!selectionPosition,
        selectedTextLength: selectedText?.length || 0,
        selectionPositionTextLength: selectionPosition?.text?.length || 0
      });
    }
  }, [visible, position, selectionPosition, selectedText]);

  useEffect(() => {
    if (!visible) {
      if (import.meta.env.DEV) {
        console.log('[FloatingAskAI] Not visible, clearing position');
      }
      setButtonPosition(null);
      return;
    }
    
    // If position is null but we have selectionPosition, create a fallback position
    let actualPosition = position;
    if (!actualPosition && selectionPosition) {
      // Create a fallback position based on viewport center
      actualPosition = new DOMRect(
        window.innerWidth / 2 - 50,
        window.innerHeight / 2,
        100,
        20
      );
    }
    
    if (!actualPosition) {
      setButtonPosition(null);
      return;
    }

    // Calculate button position
    // Position above selection if there's space, otherwise below
    const viewportHeight = window.innerHeight;
    const spaceAbove = actualPosition.top;
    const spaceBelow = viewportHeight - actualPosition.bottom;
    const buttonHeight = 36; // Approximate button height
    const offset = 8; // 8px offset from selection

    let top: number;
    if (spaceAbove > buttonHeight + offset) {
      // Position above
      top = actualPosition.top - buttonHeight - offset;
    } else if (spaceBelow > buttonHeight + offset) {
      // Position below
      top = actualPosition.bottom + offset;
    } else {
      // Default to below if neither has enough space
      top = actualPosition.bottom + offset;
    }

    // Center horizontally on selection, but keep within viewport
    const buttonWidth = 100; // Approximate button width
    let left = actualPosition.left + (actualPosition.width / 2) - (buttonWidth / 2);
    
    // Ensure button doesn't overflow viewport
    const padding = 8;
    if (left < padding) {
      left = padding;
    } else if (left + buttonWidth > window.innerWidth - padding) {
      left = window.innerWidth - buttonWidth - padding;
    }

    if (containerBounds) {
      top = top - containerBounds.top;
      left = left - containerBounds.left;
    }

    setButtonPosition({ top, left });
    
    if (import.meta.env.DEV) {
      console.log('[FloatingAskAI] Button position calculated:', { top, left });
    }
  }, [visible, position, selectionPosition]);

  if (!visible || !buttonPosition || !selectionPosition) {
    if (import.meta.env.DEV && visible) {
      console.log('[FloatingAskAI] Not rendering - missing:', {
        visible,
        hasButtonPosition: !!buttonPosition,
        hasSelectionPosition: !!selectionPosition
      });
    }
    return null;
  }
  
  // Use selectedText from selectionPosition if available, otherwise use prop
  const displayText = selectionPosition.text || selectedText;

  return (
    <div
      className={cn(
        "absolute z-50 transition-all duration-200",
        visible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
      )}
      style={{
        top: `${buttonPosition.top}px`,
        left: `${buttonPosition.left}px`,
      }}
    >
      <Button
        onClick={() => {
          // Pass position with text included
          onAskAI({
            ...selectionPosition,
            text: displayText,
          });
        }}
        size="sm"
        className={cn(
          "h-9 px-3 gap-2 shadow-lg",
          "bg-gradient-to-r from-purple-500 to-indigo-500",
          "hover:from-purple-600 hover:to-indigo-600",
          "text-white font-medium",
          "border-0",
          "backdrop-blur-sm"
        )}
      >
        <Sparkles className="h-4 w-4" />
        <span className="text-xs">Ask AI</span>
      </Button>
    </div>
  );
}
