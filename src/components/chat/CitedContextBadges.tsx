import { FolderOpen, CheckSquare, Users, StickyNote, FileText } from "lucide-react";
import { CitedContext } from "./types";
import { cn } from "@/lib/utils";

interface CitedContextBadgesProps {
  citedContext: CitedContext;
  className?: string;
  theme?: "default" | "ai-chat";
}

export function CitedContextBadges({ citedContext, className, theme = "default" }: CitedContextBadgesProps) {
  const hasProjects = citedContext.projects && citedContext.projects.length > 0;
  const hasTasks = citedContext.tasks && citedContext.tasks.length > 0;
  const hasTeams = citedContext.teams && citedContext.teams.length > 0;
  const hasDocs = citedContext.docs && citedContext.docs.length > 0;
  const hasSelectedTexts = citedContext.selectedTexts && citedContext.selectedTexts.length > 0;

  if (!hasProjects && !hasTasks && !hasTeams && !hasDocs && !hasSelectedTexts) {
    return null;
  }

  const isAIChatTheme = theme === "ai-chat";

  const renderSection = (
    icon: React.ReactNode,
    label: string,
    items: Array<{ id: string; name?: string; title?: string; text?: string }>,
    iconColor: string
  ) => {
    if (items.length === 0) return null;

    // Simplified: show icon + label + items inline, separated by commas
    const itemTexts = items.map((item) => {
      const name = item.name || item.title || item.text || "Unknown";
      // For selected text, show preview (already truncated in AIChat)
      return item.text && item.text.length > 100 
        ? item.text.substring(0, 100) + '...' 
        : name;
    });

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
        <span className={cn(
          "text-foreground/80",
          isAIChatTheme && "text-purple-700 dark:text-purple-300"
        )}>
          {itemTexts.join(", ")}
        </span>
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
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-blue-600 dark:text-blue-400"
      )}
      {hasTasks && renderSection(
        <CheckSquare className="h-3 w-3" />,
        "Tasks",
        citedContext.tasks!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-emerald-600 dark:text-emerald-400"
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
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-amber-600 dark:text-amber-400"
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

