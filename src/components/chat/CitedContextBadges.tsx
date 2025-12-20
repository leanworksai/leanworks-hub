import { FolderOpen, CheckSquare, Users, StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CitedContext } from "./types";

interface CitedContextBadgesProps {
  citedContext: CitedContext;
  className?: string;
}

export function CitedContextBadges({ citedContext, className }: CitedContextBadgesProps) {
  const hasProjects = citedContext.projects && citedContext.projects.length > 0;
  const hasTasks = citedContext.tasks && citedContext.tasks.length > 0;
  const hasTeams = citedContext.teams && citedContext.teams.length > 0;
  const hasDocs = citedContext.docs && citedContext.docs.length > 0;

  if (!hasProjects && !hasTasks && !hasTeams && !hasDocs) {
    return null;
  }

  return (
    <div className={className}>
      {hasProjects && (
        <div className="flex items-center gap-2 flex-wrap mb-1.5 w-full">
          <FolderOpen className="h-3 w-3 text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-primary flex-shrink-0 whitespace-nowrap">
            Cited Projects:
          </span>
          {citedContext.projects!.map((project) => (
            <Badge key={project.id} variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0">
              {project.name}
            </Badge>
          ))}
        </div>
      )}
      {hasTasks && (
        <div className="flex items-center gap-2 flex-wrap mb-1.5 w-full">
          <CheckSquare className="h-3 w-3 text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-primary flex-shrink-0 whitespace-nowrap">
            Cited Tasks:
          </span>
          {citedContext.tasks!.map((task) => (
            <Badge key={task.id} variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0">
              {task.title}
            </Badge>
          ))}
        </div>
      )}
      {hasTeams && (
        <div className="flex items-center gap-2 flex-wrap w-full">
          <Users className="h-3 w-3 text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-primary flex-shrink-0 whitespace-nowrap">
            Cited Teams:
          </span>
          {citedContext.teams!.map((team) => (
            <Badge key={team.id} variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0">
              {team.name}
            </Badge>
          ))}
        </div>
      )}
      {hasDocs && (
        <div className="flex items-center gap-2 flex-wrap w-full">
          <StickyNote className="h-3 w-3 text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-primary flex-shrink-0 whitespace-nowrap">
            Cited Docs:
          </span>
          {citedContext.docs!.map((doc) => (
            <Badge key={doc.id} variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0">
              {doc.title}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

