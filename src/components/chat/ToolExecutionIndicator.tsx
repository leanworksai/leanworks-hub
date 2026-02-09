import { CheckCircle2, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolExecution } from "@/hooks/useStreamingChat";

interface ToolExecutionIndicatorProps {
  tool: ToolExecution;
  theme?: "default" | "ai-chat";
}

export function ToolExecutionIndicator({ tool, theme = "default" }: ToolExecutionIndicatorProps) {
  const isAIChatTheme = theme === "ai-chat";
  const isRunning = tool.status === 'running';
  
  const duration = tool.endTime && tool.startTime 
    ? ((tool.endTime - tool.startTime) / 1000).toFixed(1) 
    : null;

  return (
    <div className={cn(
      "flex items-start gap-2 p-2 rounded-lg border transition-all",
      isAIChatTheme
        ? isRunning
          ? "bg-purple-50/50 border-purple-200/60"
          : "bg-green-50/50 border-green-200/60"
        : isRunning
          ? "bg-blue-50 border-blue-200"
          : "bg-green-50 border-green-200"
    )}>
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {isRunning ? (
          <Loader2 className={cn(
            "h-4 w-4 animate-spin",
            isAIChatTheme ? "text-purple-600" : "text-blue-600"
          )} />
        ) : (
          <CheckCircle2 className={cn(
            "h-4 w-4",
            isAIChatTheme ? "text-green-600" : "text-green-600"
          )} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Wrench className={cn(
            "h-3.5 w-3.5 flex-shrink-0",
            isAIChatTheme 
              ? isRunning ? "text-purple-600" : "text-green-600"
              : isRunning ? "text-blue-600" : "text-green-600"
          )} />
          <span className={cn(
            "font-medium text-sm",
            isAIChatTheme
              ? isRunning ? "text-purple-900" : "text-green-900"
              : isRunning ? "text-blue-900" : "text-green-900"
          )}>
            {tool.displayName}
          </span>
          {duration && (
            <span className="text-xs text-muted-foreground">
              ({duration}s)
            </span>
          )}
        </div>
        
        {/* Description or bash command */}
        {(isRunning || tool.command) && (
          <p className={cn(
            "text-xs break-words",
            isAIChatTheme
              ? "text-purple-700"
              : "text-blue-700"
          )}>
            {(tool.name === 'bash' || tool.displayName.toLowerCase().includes('bash')) && tool.command ? (
              <code className="block mt-1 p-2 rounded bg-black/5 dark:bg-white/10 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                {tool.command}
              </code>
            ) : (
              tool.description
            )}
          </p>
        )}
      </div>
    </div>
  );
}
