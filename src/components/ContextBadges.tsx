import { FolderOpen, CheckSquare, StickyNote, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Project } from "@/data/projectsData";
import { Task } from "@/data/tasksData";
import { Doc } from "@/data/docsData";
import { cn } from "@/lib/utils";
import { trackContextSelect } from "@/lib/analytics";

export interface ContextBadgeItem {
  id: string;
  label: string;
}

export interface ContextBadgesProps {
  projects?: Project[];
  tasks?: Task[];
  docs?: Doc[];
  onRemoveProject?: (project: Project) => void;
  onRemoveTask?: (task: Task) => void;
  onRemoveDoc?: (doc: Doc) => void;
  variant?: "sidebar" | "inline";
  className?: string;
}

/**
 * Shared component for displaying context badges (Projects, Tasks, Docs)
 * with remove functionality. Supports both sidebar (vertical) and inline (horizontal) layouts.
 */
export function ContextBadges({
  projects = [],
  tasks = [],
  docs = [],
  onRemoveProject,
  onRemoveTask,
  onRemoveDoc,
  variant = "inline",
  className,
}: ContextBadgesProps) {
  const hasAny = projects.length > 0 || tasks.length > 0 || docs.length > 0;

  if (!hasAny) {
    return null;
  }

  if (variant === "sidebar") {
    return (
      <div className={cn("space-y-2", className)}>
        {projects.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <FolderOpen className="h-3 w-3 text-sidebar-foreground/70" />
              <span className="text-xs font-medium text-sidebar-foreground/70">Projects</span>
            </div>
            <div className="space-y-1">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-sidebar-accent group"
                >
                  <Badge variant="secondary" className="text-xs flex-1 justify-start">
                    {project.name}
                  </Badge>
                  {onRemoveProject && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        trackContextSelect('project', project.id, 'deselect');
                        onRemoveProject(project);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {tasks.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <CheckSquare className="h-3 w-3 text-sidebar-foreground/70" />
              <span className="text-xs font-medium text-sidebar-foreground/70">Tasks</span>
            </div>
            <div className="space-y-1">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-sidebar-accent group"
                >
                  <Badge variant="secondary" className="text-xs flex-1 justify-start">
                    {task.title}
                  </Badge>
                  {onRemoveTask && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        trackContextSelect('task', task.id, 'deselect');
                        onRemoveTask(task);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {docs.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <StickyNote className="h-3 w-3 text-sidebar-foreground/70" />
              <span className="text-xs font-medium text-sidebar-foreground/70">Docs</span>
            </div>
            <div className="space-y-1">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-sidebar-accent group"
                >
                  <Badge variant="secondary" className="text-xs flex-1 justify-start">
                    {doc.title}
                  </Badge>
                  {onRemoveDoc && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        trackContextSelect('doc', doc.id, 'deselect');
                        onRemoveDoc(doc);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Inline variant (for chat input)
  return (
    <div className={className}>
      {projects.length > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <FolderOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-medium text-primary">Cited Projects:</span>
            {projects.map((project) => (
              <div key={project.id} className="relative group inline-flex">
                <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0 pr-5">
                  {project.name}
                </Badge>
                {onRemoveProject && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0"
                    onClick={() => onRemoveProject(project)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {tasks.length > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CheckSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-medium text-primary">Cited Tasks:</span>
            {tasks.map((task) => (
              <div key={task.id} className="relative group inline-flex">
                <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0 pr-5">
                  {task.title}
                </Badge>
                {onRemoveTask && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0"
                    onClick={() => onRemoveTask(task)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {docs.length > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StickyNote className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-medium text-primary">Cited Docs:</span>
            {docs.map((doc) => (
              <div key={doc.id} className="relative group inline-flex">
                <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0 pr-5">
                  {doc.title}
                </Badge>
                {onRemoveDoc && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0"
                    onClick={() => onRemoveDoc(doc)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

