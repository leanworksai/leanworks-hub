import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, MoreVertical, Users, Calendar, Trash2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserProjects, useDeleteProject } from "@/hooks/useProjects";
import { useUpdateSummaries } from "@/hooks/useUpdateSummaries";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectionMode } from "@/contexts/SelectionModeContext";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { trackClick, trackCreate, trackDelete, trackView } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const truncateText = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

export default function Projects() {
  const navigate = useNavigate();
  const { toggleProject, isProjectSelected, selectedProjects } = useSelectedProjects();
  const { isSelectionMode } = useSelectionMode();
  const { data: projects = [], isLoading } = useUserProjects();
  const { data: updateSummaries = {}, isLoading: isLoadingSummaries } = useUpdateSummaries();
  const deleteProject = useDeleteProject();
  const { toast } = useToast();
  const { isFreePlan } = useSubscription();
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null); // Stores project ID

  const handleCardClick = (projectId: string) => {
    // Don't navigate if in selection mode
    if (isSelectionMode) return;
    trackView('project', projectId);
    navigate(`/projects/${projectId}`);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleDeleteClick = (e: React.MouseEvent, projectId: string, projectName: string) => {
    e.stopPropagation();
    trackClick('delete_project', '/projects');
    setProjectToDelete(projectId);
  };

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;

    try {
      await deleteProject.mutateAsync(projectToDelete);
      trackDelete('project', projectToDelete);
      const project = projects.find(p => p.id === projectToDelete);
      toast({
        title: "Project deleted",
        description: `"${project?.name || 'Project'}" has been deleted successfully.`,
      });
      setProjectToDelete(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete project",
        variant: "destructive",
      });
    }
  };

  if (isLoading || isLoadingSummaries) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          {selectedProjects.length > 0 && (
            <p className="text-muted-foreground">
              <span className="text-primary">
                ({selectedProjects.length} selected)
              </span>
            </p>
          )}
        </div>
        <Button 
          className="bg-primary hover:bg-primary/90"
          onClick={() => {
            trackClick('create_project', '/projects');
            setIsNewProjectDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((project) => (
          <Card 
            key={project.id} 
            className={`relative bg-gradient-card border-border shadow-card cursor-pointer hover:shadow-lg transition-shadow ${
              isProjectSelected(project.id) ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => handleCardClick(project.id)}
          >
            {updateSummaries[project.id]?.updateSummary && (
              <div className="absolute top-2 left-2 z-10">
                <Popover open={hoveredProject === project.id} onOpenChange={(open) => setHoveredProject(open ? project.id : null)}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={() => setHoveredProject(project.id)}
                      onMouseLeave={() => setHoveredProject(null)}
                      title="AI Progress Summary"
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent 
                    className="w-80" 
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={() => setHoveredProject(project.id)}
                    onMouseLeave={() => setHoveredProject(null)}
                    align="start"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground/70">PROGRESS SUMMARY</p>
                        {updateSummaries[project.id]?.dateId && (
                          <p className="text-xs text-muted-foreground/60">
                            {updateSummaries[project.id].dateId}
                          </p>
                        )}
                      </div>
                      <div className={cn("relative", isFreePlan && "blur-sm pointer-events-none")}>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {updateSummaries[project.id].updateSummary}
                        </p>
                        {isFreePlan && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                              Upgrade to view progress summary
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1 mr-2">
                  <div className="flex items-center gap-3">
                    {isSelectionMode && (
                      <Checkbox
                        checked={isProjectSelected(project.id)}
                        onCheckedChange={() => toggleProject(project)}
                        onClick={handleCheckboxClick}
                        className="mt-1"
                      />
                    )}
                    <CardTitle className="text-xl">{project.name}</CardTitle>
                  </div>
                  <CardDescription className={`line-clamp-2 text-foreground ${isSelectionMode ? 'ml-7' : ''}`}>{project.description}</CardDescription>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => handleDeleteClick(e, project.id, project.name)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`flex items-center justify-between text-sm ${isSelectionMode ? 'ml-7' : ''}`}>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>{project.team} members</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>{project.dueDate}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <NewProjectDialog 
        open={isNewProjectDialogOpen} 
        onOpenChange={setIsNewProjectDialogOpen} 
      />

      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{projects.find(p => p.id === projectToDelete)?.name || 'this project'}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
