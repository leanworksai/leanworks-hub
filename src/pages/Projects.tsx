import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, Users, Calendar, Trash2, Sparkles, Share2, Edit, X } from "lucide-react";
import { MoreOptionsMenu } from "@/components/MoreOptionsMenu";
import { useNavigate } from "react-router-dom";
import { useUserProjects, useDeleteProject, useUpdateProject } from "@/hooks/useProjects";
import { ProjectUpdateSummaryCard } from "@/components/ProjectUpdateSummary";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { trackClick, trackCreate, trackDelete, trackView } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { useDateSelection } from "@/hooks/useDateSelection";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdateSummary } from "@/hooks/useUpdateSummaries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Tasks from "./Tasks";

const truncateText = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

interface ProjectCardProps {
  project: any;
  formatDateForDisplay: (date: string | null | undefined) => string;
  handleCardClick: (projectId: string) => void;
  handleDeleteClick: (e: React.MouseEvent, projectId: string, projectName: string) => void;
  isProjectSelected: (projectId: string) => boolean;
  toggleProject: (project: any) => void;
  navigate: (path: string) => void;
  setProjectToLimitVisibility: (value: { id: string; project: any } | null) => void;
  user: any;
}

function ProjectCard({
  project,
  formatDateForDisplay,
  handleCardClick,
  handleDeleteClick,
  isProjectSelected,
  toggleProject,
  navigate,
  setProjectToLimitVisibility,
  user,
}: ProjectCardProps) {
  const { data: updateSummary } = useUpdateSummary(project.id);
  const hasUpdate = updateSummary?.updateSummary;

  return (
    <div className="group">
      {/* Mobile: Single card, Desktop: Side-by-side cards */}
      <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
        {/* Main Project Card */}
        <Card 
          className={cn(
            "relative cursor-pointer group-hover:shadow-md transition-shadow overflow-hidden",
            "flex-1 h-[120px] flex flex-col" // Fixed height and flex column
          )}
          onClick={() => handleCardClick(project.id)}
        >
          {/* Mobile-only hover popover for progress update */}
          {hasUpdate && <ProjectUpdateSummaryCard projectId={project.id} />}
          <CardHeader className="pb-3 flex-shrink-0 overflow-hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <CardTitle className="text-base line-clamp-1">{project.name}</CardTitle>
                  </div>
                  
                  {/* Project Meta Info */}
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground overflow-hidden">
                    <div className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      <span>{project.memberCount} members</span>
                    </div>
                    {project.dueDate && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{formatDateForDisplay(project.dueDate)}</span>
                      </div>
                    )}
                  </div>
                  {project.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                </div>
              </div>
              <MoreOptionsMenu
                items={[
                  {
                    icon: isProjectSelected(project.id) ? X : Plus,
                    label: isProjectSelected(project.id) ? "Remove from Context" : "Add to Context",
                    onClick: (e) => {
                      toggleProject(project);
                    },
                  },
                  {
                    icon: Edit,
                    label: "Edit",
                    onClick: () => {
                      navigate(`/projects/${project.id}`);
                    },
                  },
                  {
                    icon: Share2,
                    label: "Limit Visibility",
                    onClick: (e) => {
                      setProjectToLimitVisibility({ id: project.id, project });
                    },
                    show: user && project.ownerEmail?.toLowerCase() === user.email?.toLowerCase(),
                  },
                  {
                    icon: Trash2,
                    label: "Delete",
                    onClick: (e) => handleDeleteClick(e, project.id, project.name),
                    isDestructive: true,
                    show: user && project.ownerEmail?.toLowerCase() === user.email?.toLowerCase(),
                  },
                ]}
              />
            </div>
          </CardHeader>
        </Card>

        {/* Latest Progress Update Card - Desktop only */}
        {hasUpdate ? (
          <ProjectUpdateSummaryCard projectId={project.id} desktopOnly />
        ) : (
          <div className="hidden sm:flex items-stretch gap-3 flex-1">
            {/* Empty placeholder to maintain consistent container size */}
            <div className="flex items-center justify-center w-4 flex-shrink-0">
              <div className="w-0.5 h-full min-h-[100px] bg-transparent" />
            </div>
            <Card className="flex-1 h-[120px] opacity-0 pointer-events-none">
              <CardHeader className="pb-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground/70">LATEST PROGRESS SUMMARY</p>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Projects() {
  const navigate = useNavigate();
  const { formatDateForDisplay } = useDateSelection();
  const { toggleProject, isProjectSelected, selectedProjects } = useSelectedProjects();
  const { data: projects = [], isLoading } = useUserProjects();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null); // Stores project ID for mobile hover
  const [projectToLimitVisibility, setProjectToLimitVisibility] = useState<{ id: string; project: any } | null>(null);
  const [viewMode, setViewMode] = useState<"projects" | "tasks">("projects");
  const [headerPortal, setHeaderPortal] = useState<HTMLElement | null>(null);

  const handleCardClick = (projectId: string) => {
    trackView('project', projectId);
    navigate(`/projects/${projectId}`);
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

  if (isLoading) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-12 items-center px-4 gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h1 className="text-lg font-semibold">Projects</h1>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-muted-foreground">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "projects" | "tasks")} className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
          <div className="flex h-12 items-center px-4 gap-3 flex-wrap justify-between">
            <div className="flex items-center gap-4">
              <TabsList className="h-8">
                <TabsTrigger value="projects" className="px-3">Projects</TabsTrigger>
                <TabsTrigger value="tasks" className="px-3">Tasks</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex items-center gap-2" ref={setHeaderPortal}>
              {viewMode === 'projects' && (
                <Button
                    className="bg-primary hover:bg-primary/90 h-8"
                    onClick={() => {
                      trackClick('create_project', '/projects');
                      setIsNewProjectDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Project
                  </Button>
              )}
            </div>
          </div>
        </div>

        {/* Projects List */}
        <TabsContent value="projects" className="flex-1 overflow-auto p-6 mt-0 border-0 data-[state=inactive]:hidden">
          <div className="space-y-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              formatDateForDisplay={formatDateForDisplay}
              handleCardClick={handleCardClick}
              handleDeleteClick={handleDeleteClick}
              isProjectSelected={isProjectSelected}
              toggleProject={toggleProject}
              navigate={navigate}
              setProjectToLimitVisibility={setProjectToLimitVisibility}
              user={user}
            />
          ))}
          </div>
        </TabsContent>

        {/* Tasks List */}
        <TabsContent value="tasks" className="flex-1 overflow-hidden mt-0 border-0 data-[state=inactive]:hidden">
          <Tasks embedded headerPortalRef={headerPortal} />
        </TabsContent>
      </Tabs>

      <NewProjectDialog 
        open={isNewProjectDialogOpen} 
        onOpenChange={setIsNewProjectDialogOpen} 
      />

      {/* Limit Visibility Dialog */}
      {projectToLimitVisibility && (
        <LimitVisibilityDialog
          open={!!projectToLimitVisibility}
          onOpenChange={(open) => !open && setProjectToLimitVisibility(null)}
          title="Limit Project Visibility"
          itemName={projectToLimitVisibility.project.name}
          currentVisibility={projectToLimitVisibility.project.visibility || 'all_members'}
          currentVisibleToMembers={projectToLimitVisibility.project.visibleToMembers || []}
          onSave={async (newVisibility, newVisibleToMembers) => {
            await updateProject.mutateAsync({
              projectId: projectToLimitVisibility.id,
              updates: {
                visibility: newVisibility,
                visibleToMembers: newVisibleToMembers,
              },
            });
            toast({
              title: "Visibility updated",
              description: "Project visibility has been updated successfully.",
            });
            setProjectToLimitVisibility(null);
          }}
        />
      )}

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
