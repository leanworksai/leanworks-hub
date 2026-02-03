import { FolderOpen, CheckSquare, Users, StickyNote, FileText } from "lucide-react";
import { CitedContext } from "./types";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface CitedContextBadgesProps {
  citedContext: CitedContext;
  className?: string;
  theme?: "default" | "ai-chat";
}

// Helper function to truncate text with ellipsis
const truncateText = (text: string, maxLength: number = 50): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

export function CitedContextBadges({ citedContext, className, theme = "default" }: CitedContextBadgesProps) {
  const navigate = useNavigate();
  
  const hasProjects = citedContext.projects && citedContext.projects.length > 0;
  const hasTasks = citedContext.tasks && citedContext.tasks.length > 0;
  const hasTeams = citedContext.teams && citedContext.teams.length > 0;
  const hasDocs = citedContext.docs && citedContext.docs.length > 0;
  const hasSelectedTexts = citedContext.selectedTexts && citedContext.selectedTexts.length > 0;

  if (!hasProjects && !hasTasks && !hasTeams && !hasDocs && !hasSelectedTexts) {
    return null;
  }

  const isAIChatTheme = theme === "ai-chat";

  const handleItemClick = (type: 'project' | 'task' | 'doc', id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === 'project') {
      navigate(`/projects/${id}`);
    } else if (type === 'task') {
      navigate(`/tasks/${id}`);
    } else if (type === 'doc') {
      navigate(`/docs/${id}`);
    }
  };

  const handleSelectedTextClick = (docId: string | undefined, e: React.MouseEvent) => {
    if (docId) {
      e.stopPropagation();
      navigate(`/docs/${docId}`);
    }
  };

  const renderSection = (
    icon: React.ReactNode,
    label: string,
    items: Array<{ id: string; name?: string; title?: string; text?: string; docId?: string }>,
    iconColor: string,
    itemType?: 'project' | 'task' | 'doc'
  ) => {
    if (items.length === 0) return null;

    return (
      <div className={cn("flex items-center gap-1.5 flex-wrap text-xs", "mb-1 last:mb-0")}>
        <div className={cn("flex-shrink-0", iconColor)}>
          {icon}
        </div>
        <span className={cn(
          "font-medium flex-shrink-0",
          isAIChatTheme 
            ? "text-purple-600 dark:text-purple-400" 
            : "text-foreground/70"
        )}>
          {label}:
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {items.map((item, index) => {
            const name = item.name || item.title || item.text || "Unknown";
            const displayText = item.text 
              ? truncateText(item.text, 50)
              : truncateText(name, 50);
            const isClickable = itemType && item.id;
            // For selected text, check if docId exists
            const isSelectedTextClickable = !itemType && 'docId' in item && item.docId;
            
            return (
              <span key={`${itemType || 'text'}-${item.id || index}`}>
                {isClickable ? (
                  <button
                    onClick={(e) => handleItemClick(itemType!, item.id, e)}
                    className={cn(
                      "hover:underline cursor-pointer",
                      isAIChatTheme 
                        ? "text-purple-700 dark:text-purple-300 hover:text-purple-800 dark:hover:text-purple-200"
                        : "text-foreground/80 hover:text-foreground"
                    )}
                    title={name}
                  >
                    {displayText}
                  </button>
                ) : isSelectedTextClickable ? (
                  <button
                    onClick={(e) => handleSelectedTextClick(item.docId, e)}
                    className={cn(
                      "hover:underline cursor-pointer",
                      isAIChatTheme 
                        ? "text-purple-700 dark:text-purple-300 hover:text-purple-800 dark:hover:text-purple-200"
                        : "text-foreground/80 hover:text-foreground"
                    )}
                    title={name}
                  >
                    {displayText}
                  </button>
                ) : (
                  <span className={cn(
                    "text-foreground/80",
                    isAIChatTheme && "text-purple-700 dark:text-purple-300"
                  )}>
                    {displayText}
                  </span>
                )}
                {index < items.length - 1 && (
                  <span className={cn(
                    "text-foreground/50 mx-1",
                    isAIChatTheme && "text-purple-600/50 dark:text-purple-400/50"
                  )}>
                    ,
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={cn(
      "w-full min-w-0 py-1.5 px-2",
      isAIChatTheme
        ? "bg-purple-50/50 dark:bg-purple-950/20 rounded-md border border-purple-200/40 dark:border-purple-800/30"
        : "bg-muted/50 rounded-md border border-border/40",
      className
    )}
    >
      {hasProjects && renderSection(
        <FolderOpen className="h-3 w-3" />,
        "Projects",
        citedContext.projects!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-blue-600 dark:text-blue-400",
        'project'
      )}
      {hasTasks && renderSection(
        <CheckSquare className="h-3 w-3" />,
        "Tasks",
        citedContext.tasks!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-emerald-600 dark:text-emerald-400",
        'task'
      )}
      {hasTeams && renderSection(
        <Users className="h-3 w-3" />,
        "Teams",
        citedContext.teams!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-indigo-600 dark:text-indigo-400"
      )}
      {hasDocs && renderSection(
        <StickyNote className="h-3 w-3" />,
        "Docs",
        citedContext.docs!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-amber-600 dark:text-amber-400",
        'doc'
      )}
      {hasSelectedTexts && renderSection(
        <FileText className="h-3 w-3" />,
        "Selected Text",
        citedContext.selectedTexts!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-slate-600 dark:text-slate-400"
      )}
    </div>
  );
}

