import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TextSelectionPosition } from '@/hooks/useTextSelection';

interface FloatingAskAIProps {
  visible: boolean;
  position: DOMRect | null;
  onAskAI: (selectionPosition: TextSelectionPosition) => void;
  selectionPosition: TextSelectionPosition | null;
  selectedText: string; // Keep for display purposes
}

export function FloatingAskAI({ visible, position, onAskAI, selectionPosition, selectedText }: FloatingAskAIProps) {
  const [buttonPosition, setButtonPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!visible || !position) {
      setButtonPosition(null);
      return;
    }

    // Calculate button position
    // Position above selection if there's space, otherwise below
    const viewportHeight = window.innerHeight;
    const spaceAbove = position.top;
    const spaceBelow = viewportHeight - position.bottom;
    const buttonHeight = 36; // Approximate button height
    const offset = 8; // 8px offset from selection

    let top: number;
    if (spaceAbove > buttonHeight + offset) {
      // Position above
      top = position.top - buttonHeight - offset;
    } else if (spaceBelow > buttonHeight + offset) {
      // Position below
      top = position.bottom + offset;
    } else {
      // Default to below if neither has enough space
      top = position.bottom + offset;
    }

    // Center horizontally on selection, but keep within viewport
    const buttonWidth = 100; // Approximate button width
    let left = position.left + (position.width / 2) - (buttonWidth / 2);
    
    // Ensure button doesn't overflow viewport
    const padding = 8;
    if (left < padding) {
      left = padding;
    } else if (left + buttonWidth > window.innerWidth - padding) {
      left = window.innerWidth - buttonWidth - padding;
    }

    setButtonPosition({ top, left });
  }, [visible, position]);

  if (!visible || !buttonPosition || !selectedText || !selectionPosition) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed z-50 transition-all duration-200",
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
            text: selectedText,
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
