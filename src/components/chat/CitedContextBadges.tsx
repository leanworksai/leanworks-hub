import { FolderOpen, CheckSquare, Users, StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

  if (!hasProjects && !hasTasks && !hasTeams && !hasDocs) {
    return null;
  }

  const isAIChatTheme = theme === "ai-chat";

  const renderSection = (
    icon: React.ReactNode,
    label: string,
    items: Array<{ id: string; name?: string; title?: string }>,
    iconColor: string
  ) => {
    if (items.length === 0) return null;

    return (
      <div className={cn("space-y-1 mb-2 last:mb-0")}>
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
            {icon}
          </div>
          <span className={cn(
            "text-xs font-medium",
            isAIChatTheme 
              ? "text-purple-700 dark:text-purple-300" 
              : "text-foreground/70"
          )}>
            {label}
          </span>
        </div>
        <div className="space-y-1">
          {items.map((item) => {
            const name = item.name || item.title || "Unknown";
            return (
              <div
                key={item.id}
                className="flex items-center gap-1 px-2 py-1 rounded-md"
              >
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-xs flex-1 justify-start",
                    isAIChatTheme
                      ? "bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200/60 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800/60"
                      : "bg-background hover:bg-accent text-foreground border border-border/60"
                  )}
                >
                  {name}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={cn(
      "w-full min-w-0 space-y-2",
      isAIChatTheme
        ? "bg-gradient-to-br from-purple-50/80 to-indigo-50/50 dark:from-purple-950/30 dark:to-indigo-950/20 rounded-lg p-3 border border-purple-200/60 dark:border-purple-800/40 shadow-sm"
        : "bg-gradient-to-br from-blue-50/60 via-slate-50/40 to-blue-50/60 dark:from-blue-950/20 dark:via-slate-950/30 dark:to-blue-950/20 rounded-lg p-3.5 border border-blue-200/40 dark:border-blue-900/30 shadow-sm backdrop-blur-sm",
      className
    )}>
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
    </div>
  );
}

