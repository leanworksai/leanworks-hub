import { useEffect, useRef } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ToolExecutionIndicator } from "./ToolExecutionIndicator";
import type { StreamingState } from "@/hooks/useStreamingChat";
import { marked } from "marked";

// Configure marked for safe HTML output
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface StreamingMessageProps {
  streamingState: StreamingState;
  theme?: "default" | "ai-chat";
}

// Check if content has markdown formatting
function hasMarkdownFormatting(content: string): boolean {
  const markdownPatterns = [
    /\*\*[^*]+\*\*/,
    /\*[^*]+\*/,
    /__[^_]+__/,
    /_[^_]+_/,
    /`[^`]+`/,
    /```[\s\S]*?```/,
    /^#{1,6}\s/m,
    /^\s*[-*+]\s/m,
    /^\s*\d+\.\s/m,
    /\[.+\]\(.+\)/,
    /^\s*>/m,
    /~~[^~]+~~/,
  ];
  
  return markdownPatterns.some(pattern => pattern.test(content));
}

export function StreamingMessage({ streamingState, theme = "default" }: StreamingMessageProps) {
  const isAIChatTheme = theme === "ai-chat";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll as content streams in
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingState.content, streamingState.toolExecutions]);

  // Render content with markdown if needed
  const renderContent = () => {
    if (!streamingState.content) return null;

    const shouldParseMarkdown = hasMarkdownFormatting(streamingState.content);

    if (shouldParseMarkdown) {
      const htmlContent = marked.parse(streamingState.content, { async: false }) as string;
      
      return (
        <div 
          className={cn(
            "prose prose-sm max-w-none break-words min-w-0",
            "dark:prose-invert",
            "prose-p:my-1 prose-p:leading-relaxed prose-p:break-words",
            "prose-headings:my-2 prose-headings:font-semibold prose-headings:break-words",
            "prose-ul:my-1 prose-ol:my-1",
            "prose-li:my-0.5 prose-li:break-words",
            "prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-code:break-words",
            "prose-pre:my-2 prose-pre:p-3 prose-pre:rounded-lg prose-pre:bg-muted prose-pre:overflow-x-auto prose-pre:max-w-full prose-pre:min-w-0",
            "prose-blockquote:my-2 prose-blockquote:border-l-primary prose-blockquote:pl-4 prose-blockquote:break-words",
            "prose-a:text-primary prose-a:underline prose-a:decoration-primary/50 hover:prose-a:decoration-primary prose-a:break-words",
            isAIChatTheme && "prose-invert prose-p:text-white prose-headings:text-white prose-strong:text-white prose-code:bg-white/20 prose-code:text-white prose-pre:bg-white/10 prose-a:text-white/90 hover:prose-a:text-white prose-blockquote:border-white/50 prose-blockquote:text-white/90 prose-li:text-white"
          )}
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      );
    }

    return (
      <div 
        className={cn(
          "text-sm break-words font-medium whitespace-pre-wrap",
          isAIChatTheme ? "text-white leading-relaxed" : "text-foreground"
        )}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {streamingState.content}
      </div>
    );
  };

  return (
    <div className="flex gap-3 w-full min-w-0 max-w-full justify-start animate-in fade-in slide-in-from-bottom-2">
      {/* Avatar */}
      <Avatar className={cn(
        "flex-shrink-0",
        isAIChatTheme ? "h-9 w-9 ring-2 ring-purple-200/50" : "h-8 w-8"
      )}>
        <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
        <AvatarFallback className={cn(
          isAIChatTheme 
            ? "bg-gradient-to-br from-purple-500 to-indigo-500 text-white font-semibold"
            : "bg-muted-foreground/20 text-foreground"
        )}>
          L
        </AvatarFallback>
      </Avatar>

      {/* Message content */}
      <div className="flex flex-col min-w-0 shrink relative max-w-[75%]">
        {/* Sender info */}
        <div className="flex items-center gap-2 mb-1.5 px-1">
          <p className={cn(
            "font-medium text-sm",
            isAIChatTheme ? "text-black" : "text-foreground"
          )}>
            lean
          </p>
          {streamingState.isStreaming && (
            <div className="flex gap-1">
              <div className={cn(
                "h-1.5 w-1.5 rounded-full animate-bounce",
                isAIChatTheme ? "bg-purple-500" : "bg-blue-500"
              )} style={{ animationDelay: "0ms" }} />
              <div className={cn(
                "h-1.5 w-1.5 rounded-full animate-bounce",
                isAIChatTheme ? "bg-indigo-500" : "bg-blue-500"
              )} style={{ animationDelay: "150ms" }} />
              <div className={cn(
                "h-1.5 w-1.5 rounded-full animate-bounce",
                isAIChatTheme ? "bg-purple-500" : "bg-blue-500"
              )} style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>

        {/* Message bubble */}
        <div 
          className={cn(
            "px-4 py-3 break-words min-w-0 w-full overflow-x-hidden transition-all",
            isAIChatTheme
              ? "rounded-2xl rounded-tl-sm bg-white/90 backdrop-blur-sm border border-purple-200/60 shadow-sm"
              : "rounded-lg bg-muted border border-border"
          )}
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
        >
          {/* Tool executions */}
          {streamingState.toolExecutions.length > 0 && (
            <div className="space-y-2 mb-3">
              {streamingState.toolExecutions.map((tool, idx) => (
                <ToolExecutionIndicator 
                  key={`${tool.name}-${idx}`} 
                  tool={tool} 
                  theme={theme}
                />
              ))}
            </div>
          )}

          {/* Text content */}
          {renderContent()}

          {/* Cursor animation while streaming */}
          {streamingState.isStreaming && streamingState.content && (
            <span className={cn(
              "inline-block w-0.5 h-4 ml-0.5 animate-pulse",
              isAIChatTheme ? "bg-purple-500" : "bg-blue-500"
            )} />
          )}

          {/* Error state */}
          {streamingState.error && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              Error: {streamingState.error}
            </div>
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
