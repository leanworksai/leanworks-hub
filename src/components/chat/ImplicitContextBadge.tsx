import { MapPin, StickyNote, CheckSquare, FolderOpen, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface ImplicitContextBadgeProps {
  implicitContext: string;
  className?: string;
  theme?: "default" | "ai-chat";
  variant?: "inline" | "message" | "sidebar"; // inline for chat input, message for chat messages, sidebar for sidebar
  onRemove?: () => void; // Callback to remove implicit context
}

// Helper function to truncate text with ellipsis
const truncateText = (text: string, maxLength: number = 50): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

export function ImplicitContextBadge({ 
  implicitContext, 
  className, 
  theme = "default",
  variant = "message",
  onRemove
}: ImplicitContextBadgeProps) {
  const navigate = useNavigate();
  
  if (!implicitContext) {
    return null;
  }

  const isAIChatTheme = theme === "ai-chat";

  // Parse the implicit context string to extract type, title, and ID
  // Format: "Current {type}: {title} (ID: {id})"
  const match = implicitContext.match(/Current\s+(\w+):\s+(.+?)\s+\(ID:\s*([^)]+)\)/);
  const contextType = match ? match[1] : null;
  const contextId = match ? match[3].trim() : null;
  // Extract title more carefully - everything between ": " and " (ID:"
  const titleMatch = implicitContext.match(/Current\s+\w+:\s+(.+?)\s+\(ID:/);
  const contextTitle = titleMatch ? titleMatch[1].trim() : implicitContext;
  const truncatedTitle = truncateText(contextTitle, variant === "inline" ? 40 : 50);
  
  // Navigation handler
  const handleClick = (e: React.MouseEvent) => {
    if (!contextType || !contextId) return;
    e.stopPropagation();
    if (contextType === 'doc') {
      navigate(`/docs/${contextId}`);
    } else if (contextType === 'task') {
      navigate(`/tasks/${contextId}`);
    } else if (contextType === 'project') {
      navigate(`/projects/${contextId}`);
    }
  };
  
  // Format the context type for display
  const formatContextType = (type: string | null): string => {
    if (!type) return "Context";
    const typeMap: Record<string, string> = {
      'doc': 'Document',
      'task': 'Task',
      'project': 'Project',
      'team-chat': 'Team Chat',
    };
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };
  
  const displayType = formatContextType(contextType);

  // Get icon based on context type
  const getIcon = () => {
    switch (contextType) {
      case 'doc':
        return <StickyNote className="h-3.5 w-3.5" />;
      case 'task':
        return <CheckSquare className="h-3.5 w-3.5" />;
      case 'project':
        return <FolderOpen className="h-3.5 w-3.5" />;
      default:
        return <MapPin className="h-3.5 w-3.5" />;
    }
  };

  // Sidebar variant (for sidebar) - matches ContextBadges sidebar style exactly
  if (variant === "sidebar") {
    // Get the section label based on context type (same as ContextBadges)
    const sectionLabel = contextType === 'doc' ? 'Docs' : 
                        contextType === 'task' ? 'Tasks' : 
                        contextType === 'project' ? 'Projects' : 
                        displayType;
    
    return (
      <div className={cn("space-y-1", className)}>
        <div className="flex items-center gap-1.5 px-2 py-1">
          <div className="text-sidebar-foreground/70">
            {getIcon()}
          </div>
          <span className="text-xs font-medium text-sidebar-foreground/70">{sectionLabel}</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-sidebar-accent group">
            <Badge 
              variant="secondary" 
              className="text-xs flex-1 justify-start cursor-pointer hover:bg-sidebar-accent/80"
              onClick={handleClick}
              title={contextTitle}
            >
              {truncatedTitle}
            </Badge>
            {onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={onRemove}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Inline variant (for chat input) - matches ContextBadges inline style exactly
  if (variant === "inline") {
    // Get the section label based on context type (same as ContextBadges)
    const sectionLabel = contextType === 'doc' ? 'Cited Docs:' : 
                        contextType === 'task' ? 'Cited Tasks:' : 
                        contextType === 'project' ? 'Cited Projects:' : 
                        `Cited ${displayType}:`;
    
    return (
      <div className={cn("px-4 pt-3 pb-2", className)}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={cn(
            "flex-shrink-0",
            isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-primary"
          )}>
            {getIcon()}
          </div>
          <span className={cn(
            "text-xs font-medium flex-shrink-0",
            isAIChatTheme ? "text-purple-700 dark:text-purple-300" : "text-primary"
          )}>
            {sectionLabel}
          </span>
          <div className="relative group inline-flex">
            <Badge 
              variant="secondary" 
              className={cn(
                "text-xs whitespace-nowrap flex-shrink-0 cursor-pointer",
                onRemove ? "pr-5" : "",
                isAIChatTheme
                  ? "bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200/60 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800/60"
                  : "bg-background hover:bg-accent text-foreground border border-border/60"
              )}
              onClick={handleClick}
              title={contextTitle}
            >
              {truncatedTitle}
            </Badge>
            {onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0"
                onClick={onRemove}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Message variant (for chat messages) - matches sidebar style
  const sectionLabel = contextType === 'doc' ? 'Docs' : 
                      contextType === 'task' ? 'Tasks' : 
                      contextType === 'project' ? 'Projects' : 
                      displayType;
  
  const iconColor = isAIChatTheme 
    ? "text-purple-600 dark:text-purple-400" 
    : (contextType === 'doc' ? "text-amber-600 dark:text-amber-400" :
       contextType === 'task' ? "text-emerald-600 dark:text-emerald-400" :
       contextType === 'project' ? "text-blue-600 dark:text-blue-400" :
       "text-blue-600 dark:text-blue-400");

  return (
    <div className={cn(
      "w-full min-w-0 space-y-2",
      isAIChatTheme
        ? "bg-gradient-to-br from-purple-50/80 to-indigo-50/50 dark:from-purple-950/30 dark:to-indigo-950/20 rounded-lg p-3 border border-purple-200/60 dark:border-purple-800/40 shadow-sm"
        : "bg-gradient-to-br from-blue-50/60 via-slate-50/40 to-blue-50/60 dark:from-blue-950/20 dark:via-slate-950/30 dark:to-blue-950/20 rounded-lg p-3.5 border border-blue-200/40 dark:border-blue-900/30 shadow-sm backdrop-blur-sm",
      className
    )}>
      <div className="space-y-1">
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1",
          isAIChatTheme 
            ? "text-purple-700 dark:text-purple-300" 
            : "text-foreground/70"
        )}>
          <div className={cn(
            "flex-shrink-0",
            iconColor
          )}>
            {getIcon()}
          </div>
          <span className={cn(
            "text-xs font-medium",
            isAIChatTheme 
              ? "text-purple-700 dark:text-purple-300" 
              : "text-foreground/70"
          )}>
            {sectionLabel}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-md group">
            <Badge
              variant="secondary"
              className={cn(
                "text-xs flex-1 justify-start cursor-pointer",
                isAIChatTheme
                  ? "bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200/60 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800/60"
                  : "bg-background hover:bg-accent text-foreground border border-border/60"
              )}
              onClick={handleClick}
              title={contextTitle}
            >
              {truncatedTitle}
            </Badge>
            {onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={onRemove}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
