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
  implicitContext?: string; // Current page context string
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
  implicitContext,
}: ContextBadgesProps) {
  // Parse implicit context if provided
  let implicitDoc: { id: string; title: string } | null = null;
  let implicitTask: { id: string; title: string } | null = null;
  let implicitProject: { id: string; name: string } | null = null;
  
  if (implicitContext) {
    const match = implicitContext.match(/Current\s+(\w+):\s+(.+?)\s+\(ID:\s*([^)]+)\)/);
    if (match) {
      const contextType = match[1];
      const contextTitle = match[2].trim();
      const contextId = match[3].trim();
      
      if (contextType === 'doc') {
        implicitDoc = { id: contextId, title: contextTitle };
      } else if (contextType === 'task') {
        implicitTask = { id: contextId, title: contextTitle };
      } else if (contextType === 'project') {
        implicitProject = { id: contextId, name: contextTitle };
      }
    }
  }
  
  // Combine implicit and explicit contexts
  const allProjects = implicitProject 
    ? [...projects, implicitProject as Project]
    : projects;
  const allTasks = implicitTask 
    ? [...tasks, implicitTask as Task]
    : tasks;
  const allDocs = implicitDoc 
    ? [...docs, implicitDoc as Doc]
    : docs;
  
  const hasAny = allProjects.length > 0 || allTasks.length > 0 || allDocs.length > 0;

  if (!hasAny) {
    return null;
  }

  if (variant === "sidebar") {
    return (
      <div className={cn("space-y-2", className)}>
        {allProjects.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <FolderOpen className="h-3 w-3 text-sidebar-foreground/70" />
              <span className="text-xs font-medium text-sidebar-foreground/70">Projects</span>
            </div>
            <div className="space-y-1">
              {allProjects.map((project) => {
                const isImplicit = implicitProject && project.id === implicitProject.id;
                return (
                <div
                  key={project.id}
                  className="flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-sidebar-accent group"
                >
                  <Badge variant="secondary" className="text-xs flex-1 justify-start">
                    {project.name}
                  </Badge>
                  {onRemoveProject && !isImplicit && (
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
                );
              })}
            </div>
          </div>
        )}
        {allTasks.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <CheckSquare className="h-3 w-3 text-sidebar-foreground/70" />
              <span className="text-xs font-medium text-sidebar-foreground/70">Tasks</span>
            </div>
            <div className="space-y-1">
              {allTasks.map((task) => {
                const isImplicit = implicitTask && task.id === implicitTask.id;
                return (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-sidebar-accent group"
                >
                  <Badge variant="secondary" className="text-xs flex-1 justify-start">
                    {task.title}
                  </Badge>
                  {onRemoveTask && !isImplicit && (
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
                );
              })}
            </div>
          </div>
        )}
        {allDocs.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <StickyNote className="h-3 w-3 text-sidebar-foreground/70" />
              <span className="text-xs font-medium text-sidebar-foreground/70">Docs</span>
            </div>
            <div className="space-y-1">
              {allDocs.map((doc) => {
                const isImplicit = implicitDoc && doc.id === implicitDoc.id;
                return (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-sidebar-accent group"
                >
                  <Badge variant="secondary" className="text-xs flex-1 justify-start">
                    {doc.title}
                  </Badge>
                  {onRemoveDoc && !isImplicit && (
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
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Inline variant (for chat input)
  return (
    <div className={className}>
      {allProjects.length > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <FolderOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-medium text-primary">Cited Projects:</span>
            {allProjects.map((project) => {
              const isImplicit = implicitProject && project.id === implicitProject.id;
              return (
              <div key={project.id} className="relative group inline-flex">
                <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0 pr-5">
                  {project.name}
                </Badge>
                {onRemoveProject && !isImplicit && (
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
              );
            })}
          </div>
        </div>
      )}
      {allTasks.length > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CheckSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-medium text-primary">Cited Tasks:</span>
            {allTasks.map((task) => {
              const isImplicit = implicitTask && task.id === implicitTask.id;
              return (
              <div key={task.id} className="relative group inline-flex">
                <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0 pr-5">
                  {task.title}
                </Badge>
                {onRemoveTask && !isImplicit && (
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
              );
            })}
          </div>
        </div>
      )}
      {allDocs.length > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StickyNote className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-medium text-primary">Cited Docs:</span>
            {allDocs.map((doc) => {
              const isImplicit = implicitDoc && doc.id === implicitDoc.id;
              return (
              <div key={doc.id} className="relative group inline-flex">
                <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0 pr-5">
                  {doc.title}
                </Badge>
                {onRemoveDoc && !isImplicit && (
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

