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
    iconColor: string,
    iconBgColor: string
  ) => {
    if (items.length === 0) return null;

    return (
      <div className={cn(
        "flex items-start gap-3 mb-2.5 last:mb-0",
        isAIChatTheme && "mb-3"
      )}>
        <div className={cn(
          "flex-shrink-0 mt-0.5 p-2 rounded-lg shadow-sm",
          iconBgColor
        )}>
          <div className={iconColor}>
            {icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn(
            "text-xs font-semibold mb-2 tracking-wide",
            isAIChatTheme 
              ? "text-purple-700 dark:text-purple-300" 
              : "text-foreground/80"
          )}>
            {label}
          </div>
          <div className="flex flex-wrap gap-2">
            {items.map((item) => {
              const name = item.name || item.title || "Unknown";
              return (
                <Badge
                  key={item.id}
                  variant="secondary"
                  className={cn(
                    "text-xs font-medium px-3 py-1.5 rounded-lg transition-all cursor-default shadow-sm",
                    isAIChatTheme
                      ? "bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200/60 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800/60 dark:hover:bg-purple-900/60"
                      : "bg-background hover:bg-accent text-foreground border border-border/60 hover:border-border shadow-sm hover:shadow"
                  )}
                >
                  {name}
                </Badge>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={cn(
      "w-full min-w-0",
      isAIChatTheme
        ? "bg-gradient-to-br from-purple-50/80 to-indigo-50/50 dark:from-purple-950/30 dark:to-indigo-950/20 rounded-lg p-3 border border-purple-200/60 dark:border-purple-800/40 shadow-sm"
        : "bg-gradient-to-br from-blue-50/60 via-slate-50/40 to-blue-50/60 dark:from-blue-950/20 dark:via-slate-950/30 dark:to-blue-950/20 rounded-lg p-3.5 border border-blue-200/40 dark:border-blue-900/30 shadow-sm backdrop-blur-sm",
      className
    )}>
      {hasProjects && renderSection(
        <FolderOpen className="h-4 w-4" />,
        "Cited Projects",
        citedContext.projects!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-blue-600 dark:text-blue-400",
        isAIChatTheme ? "bg-purple-100/80 dark:bg-purple-900/30" : "bg-blue-100/70 dark:bg-blue-900/30"
      )}
      {hasTasks && renderSection(
        <CheckSquare className="h-4 w-4" />,
        "Cited Tasks",
        citedContext.tasks!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-emerald-600 dark:text-emerald-400",
        isAIChatTheme ? "bg-purple-100/80 dark:bg-purple-900/30" : "bg-emerald-100/70 dark:bg-emerald-900/30"
      )}
      {hasTeams && renderSection(
        <Users className="h-4 w-4" />,
        "Cited Teams",
        citedContext.teams!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-indigo-600 dark:text-indigo-400",
        isAIChatTheme ? "bg-purple-100/80 dark:bg-purple-900/30" : "bg-indigo-100/70 dark:bg-indigo-900/30"
      )}
      {hasDocs && renderSection(
        <StickyNote className="h-4 w-4" />,
        "Cited Docs",
        citedContext.docs!,
        isAIChatTheme ? "text-purple-600 dark:text-purple-400" : "text-amber-600 dark:text-amber-400",
        isAIChatTheme ? "bg-purple-100/80 dark:bg-purple-900/30" : "bg-amber-100/70 dark:bg-amber-900/30"
      )}
    </div>
  );
}

