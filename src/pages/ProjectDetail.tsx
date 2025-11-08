import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
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
import { ArrowLeft, Users, Calendar, CheckCircle2, Circle, Clock, ChevronDown, Send, Activity, MessageSquare, Trash2 } from "lucide-react";
import { useUserProjects, useDeleteProject } from "@/hooks/useProjects";
import { useAuth } from "@/contexts/AuthContext";
import { useUserTeams } from "@/hooks/useTeams";
import { teamsService } from "@/services/firestore";
import { useQueries } from "@tanstack/react-query";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

// Helper function to safely convert date values to strings
// Handles Firestore Timestamps, Date objects, strings, and numbers
const formatDate = (dateValue: any): string => {
  if (!dateValue) return '';
  
  // If it's already a string, return it
  if (typeof dateValue === 'string') {
    return dateValue;
  }
  
  // If it's a Firestore Timestamp object (has _seconds and _nanoseconds)
  if (dateValue && typeof dateValue === 'object' && '_seconds' in dateValue) {
    const seconds = dateValue._seconds || 0;
    const date = new Date(seconds * 1000);
    return date.toISOString().split('T')[0];
  }
  
  // If it's a Date object
  if (dateValue instanceof Date) {
    return dateValue.toISOString().split('T')[0];
  }
  
  // If it's a number (timestamp in milliseconds)
  if (typeof dateValue === 'number') {
    return new Date(dateValue).toISOString().split('T')[0];
  }
  
  // Fallback: try to convert to string
  return String(dateValue);
};

export default function ProjectDetail() {
  const { projectName: projectNameParam } = useParams();
  const navigate = useNavigate();
  const [commentInput, setCommentInput] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteProject = useDeleteProject();
  const { toast } = useToast();
  
  // Log that component is rendering
  useEffect(() => {
    console.log('🔵 ProjectDetail component rendered', { projectNameParam });
  }, [projectNameParam]);
  
  // Convert URL slug back to project name
  // Project names in Firestore are stored with original casing
  // We need to fetch all projects and find the matching one by slug
  const { data: projects = [], isLoading: isLoadingProjects, error: projectsError } = useUserProjects();
  const { user } = useAuth();
  const { data: userTeams = [] } = useUserTeams();
  
  // Fetch team details to check project access
  const teamDetailsQueries = useQueries({
    queries: userTeams.map((team) => ({
      queryKey: ['teams', team.name],
      queryFn: () => teamsService.getById(team.name),
      enabled: !!team.name && !!user?.email,
      staleTime: 1000 * 60 * 5,
    })),
  });
  
  // Get all team member names from user's teams
  const userTeamMemberNames = new Set<string>();
  teamDetailsQueries.forEach((query) => {
    if (query.data?.members) {
      query.data.members.forEach((member) => {
        userTeamMemberNames.add(member.name.toLowerCase());
      });
    }
  });
  
  // Check if user has access to the project
  const hasAccess = project ? project.members.some((member) =>
    userTeamMemberNames.has(member.name.toLowerCase())
  ) : false;
  
  // Redirect if user doesn't have access
  useEffect(() => {
    if (!isLoadingProjects && project && userTeamMemberNames.size > 0 && !hasAccess) {
      navigate("/projects");
    }
  }, [isLoadingProjects, project, hasAccess, userTeamMemberNames.size, navigate]);
  
  // Normalize the URL parameter (React Router already decodes it)
  const normalizedSlug = projectNameParam 
    ? projectNameParam.toLowerCase()
    : null;
  
  // Helper function to create slug from project name (must match Projects.tsx)
  const createSlug = (name: string) => {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  };
  
  const project = normalizedSlug && projects.length > 0
    ? projects.find(p => createSlug(p.name) === normalizedSlug)
    : null;
  const isLoading = isLoadingProjects;

  // Debug logging (remove in production)
  useEffect(() => {
    console.log('🟢 ProjectDetail State:', {
      projectNameParam,
      normalizedSlug,
      isLoading,
      projectsCount: projects.length,
      hasError: !!projectsError,
      error: projectsError,
      projectNames: projects.map(p => p.name),
      projectSlugs: projects.map(p => createSlug(p.name)),
      foundProject: project?.name || 'NOT FOUND',
      projectMatch: project ? '✅' : '❌'
    });
  }, [projectNameParam, normalizedSlug, isLoading, projects, project, projectsError]);

  const handleDelete = async () => {
    if (!project) return;

    try {
      await deleteProject.mutateAsync(project.name);
      toast({
        title: "Project deleted",
        description: `"${project.name}" has been deleted successfully.`,
      });
      navigate("/projects");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete project",
        variant: "destructive",
      });
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  // Show error if projects failed to load
  if (projectsError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="text-center py-12 space-y-4">
          <h1 className="text-2xl font-bold text-destructive">Error loading projects</h1>
          <p className="text-muted-foreground">
            {projectsError instanceof Error ? projectsError.message : 'Failed to load projects'}
          </p>
        </div>
      </div>
    );
  }

  // Show not found if no projectNameParam
  if (!projectNameParam) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold">Invalid project URL</h1>
          <p className="text-muted-foreground">No project specified in the URL</p>
        </div>
      </div>
    );
  }

  // Show access denied if user doesn't have access
  if (project && userTeamMemberNames.size > 0 && !hasAccess && !isLoadingProjects) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">You don't have access to this project.</p>
        </div>
      </div>
    );
  }

  // Show not found if project doesn't exist
  if (!project && !isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="text-center py-12 space-y-4">
          <h1 className="text-2xl font-bold">Project not found</h1>
          <p className="text-muted-foreground">
            Could not find a project matching "{normalizedSlug}"
          </p>
          {projects.length > 0 && (
            <div className="text-sm text-muted-foreground mt-4 max-w-md mx-auto">
              <p className="font-medium mb-2">Available projects:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-left">
                {projects.slice(0, 5).map(p => (
                  <li key={p.name}>
                    <span className="font-medium">{p.name}</span> → slug: <code className="bg-secondary px-1 rounded">{createSlug(p.name)}</code>
                  </li>
                ))}
              </ul>
              {projects.length > 5 && <p className="mt-2">... and {projects.length - 5} more</p>}
            </div>
          )}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">No projects available</p>
          )}
        </div>
      </div>
    );
  }

  const getTaskIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "in-progress":
        return <Clock className="h-4 w-4 text-blue-500" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const handleAddComment = () => {
    const comment = commentInput.trim();
    if (!comment) return;
    
    // In a real app, this would send to an API
    // For now, we'll just clear the input
    setCommentInput("");
  };

  // Combine and sort activities (updates and comments) by date
  const getActivities = () => {
    if (!project) return [];
    
    const activities = [
      ...project.progressUpdates.map(update => ({
        id: update.id,
        type: "update" as const,
        memberName: update.memberName,
        memberAvatar: update.memberAvatar,
        date: update.date,
        content: update.update,
      })),
      ...project.comments.map(comment => ({
        id: comment.id,
        type: "comment" as const,
        memberName: comment.memberName,
        memberAvatar: comment.memberAvatar,
        date: comment.date,
        content: comment.comment,
      })),
    ];
    
    // Sort by date (newest first)
    return activities.sort((a, b) => {
      // Safely convert dates to timestamps for comparison
      const getDateTimestamp = (dateValue: any): number => {
        if (!dateValue) return 0;
        
        // If it's a Firestore Timestamp object
        if (dateValue && typeof dateValue === 'object' && '_seconds' in dateValue) {
          return (dateValue._seconds || 0) * 1000;
        }
        
        // Try to parse as Date
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? 0 : date.getTime();
      };
      
      const dateA = getDateTimestamp(a.date);
      const dateB = getDateTimestamp(b.date);
      return dateB - dateA;
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Button variant="ghost" onClick={() => navigate("/projects")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Projects
      </Button>

      <div>
        <div className="flex items-start justify-between mb-2">
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Project
          </Button>
        </div>
        <p className="text-muted-foreground text-lg mb-4">{project.description}</p>
        <p className="text-foreground mb-4">{project.detailedDescription}</p>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>Created: <span className="text-foreground font-medium">{formatDate(project.createdDate)}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>Due: <span className="text-foreground font-medium">{formatDate(project.dueDate)}</span></span>
          </div>
        </div>
      </div>

      <Card className="bg-gradient-card border-border shadow-card">
        <Collapsible defaultOpen={true}>
          <CardHeader>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center justify-between hover:opacity-80 transition-opacity cursor-pointer">
                <CardTitle className="text-xl">Project Members</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>{project.team} members</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
                </div>
              </div>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {project.members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border">
                    <Avatar>
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {member.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{member.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{member.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Card className="bg-gradient-card border-border shadow-card">
        <Collapsible defaultOpen={true}>
          <CardHeader>
            <CollapsibleTrigger className="w-full">
              <div className="space-y-3">
                <div className="flex items-center justify-between hover:opacity-80 transition-opacity cursor-pointer">
                  <CardTitle className="text-xl">Tasks</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {project.tasks.filter(t => t.status === "completed").length} / {project.tasks.length} completed
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
                  </div>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${(project.tasks.filter(t => t.status === "completed").length / project.tasks.length) * 100}%` }}
                  />
                </div>
              </div>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div className="space-y-3">
                {project.tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border">
                    <div className="mt-0.5">
                      {getTaskIcon(task.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm mb-1">{task.title}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>Assignee: {task.assignee}</span>
                        <span>Due: {formatDate(task.dueDate)}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">
                      {task.status.replace("-", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Card className="bg-gradient-card border-border shadow-card">
        <Collapsible defaultOpen={true}>
          <CardHeader>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center justify-between hover:opacity-80 transition-opacity cursor-pointer">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-xl">Activities</CardTitle>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
              </div>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div className="space-y-4">
                {/* Comment Input */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Add a comment..."
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      className="min-h-[80px] resize-none"
                    />
                    <Button
                      size="icon"
                      onClick={handleAddComment}
                      disabled={!commentInput.trim()}
                      className="h-[80px]"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Activities List */}
                {getActivities().length > 0 ? (
                  <div className="space-y-4">
                    {getActivities().map((activity) => (
                      <div 
                        key={activity.id} 
                        className={`border-l-2 pl-4 pb-4 last:pb-0 ${
                          activity.type === "update" 
                            ? "border-primary" 
                            : "border-muted-foreground/20"
                        }`}
                      >
                        <div className="flex items-start gap-3 mb-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {activity.memberAvatar}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-sm">{activity.memberName}</p>
                              <span className="text-xs text-muted-foreground">{formatDate(activity.date)}</span>
                              {activity.type === "comment" && (
                                <Badge 
                                  className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 text-xs flex items-center gap-1"
                                  variant="outline"
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  <span>comment</span>
                                </Badge>
                              )}
                              {activity.type === "update" && (
                                <Badge 
                                  className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-xs flex items-center gap-1"
                                  variant="outline"
                                >
                                  <Activity className="h-3 w-3" />
                                  <span>update</span>
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">{activity.content}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No activities yet
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{project?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
