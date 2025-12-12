import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface DraftResponseButtonProps {
  position: "left" | "right";
  showOnHover?: boolean;
  onClick: () => void;
  isLoading?: boolean;
}

export function DraftResponseButton({
  position,
  showOnHover = false,
  onClick,
  isLoading = false,
}: DraftResponseButtonProps) {
  // Button component (no wrapper div since positioning is handled by parent)
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-all shadow-md whitespace-nowrap",
        "bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30",
        "border border-blue-200/50 dark:border-blue-800/50",
        "text-blue-600 dark:text-blue-400",
        "hover:from-blue-100 hover:to-purple-100 dark:hover:from-blue-900/40 dark:hover:to-purple-900/40",
        "hover:border-blue-300/70 dark:hover:border-blue-700/70",
        "hover:shadow-lg hover:scale-105",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
        isLoading && "animate-pulse"
      )}
      title="Draft response with AI"
    >
      <Sparkles className={cn(
        "h-3.5 w-3.5",
        isLoading && "animate-pulse"
      )} />
    </button>
  );
}
