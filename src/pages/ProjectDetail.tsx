import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { getAvatarColor } from "@/lib/utils";
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
import { ArrowLeft, Users, Calendar, CheckCircle2, Circle, Clock, ChevronDown, ChevronLeft, ChevronRight, Send, Activity, MessageSquare, Trash2, Plus, X, Check, Share2, Sparkles, MoreVertical } from "lucide-react";
import { useUserProjects, useDeleteProject, useProject, useAddProjectMember, useRemoveProjectMember, useUpdateProject } from "@/hooks/useProjects";
import { trackUpdate, trackEvent, trackSearch } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";
import { projectsService } from "@/services/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useUsers } from "@/hooks/useUsers";
import { useUserMap } from "@/hooks/useUserMap";
import { useSubscription } from "@/hooks/useSubscription";
import { cn } from "@/lib/utils";
import { TaskTooltip } from "@/components/TaskTooltip";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatDateStringInTimezone } from "@/lib/dateTimeUtils";
import { useAllUpdateSummaries } from "@/hooks/useUpdateSummaries";
import { useScrollTracking } from "@/hooks/useScrollTracking";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useDateSelection } from "@/hooks/useDateSelection";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { usePageContext } from "@/contexts/PageContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { formatDateForDisplay } = useDateSelection();
  const [commentInput, setCommentInput] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [taskPageIndex, setTaskPageIndex] = useState(0);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  const [selectedMemberEmail, setSelectedMemberEmail] = useState<string>("");
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberPopoverOpen, setMemberPopoverOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<{ email: string; name: string } | null>(null);
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false);
  const [showLimitVisibilityDialog, setShowLimitVisibilityDialog] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editedProject, setEditedProject] = useState<any>(null);
  const deleteProject = useDeleteProject();
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();
  const updateProject = useUpdateProject();
  const { toast } = useToast();
  // Removed free tier restrictions - viewing AI content is now available to all
  const queryClient = useQueryClient();
  
  // Fetch project by ID
  // Backend already handles access control - if user doesn't have access, it returns 403
  const { data: project, isLoading: isLoadingProject, error: projectError } = useProject(projectId || '');
  const { data: projects = [] } = useUserProjects();
  const { user } = useAuth();
  const { data: users = [] } = useUsers();
  const userMap = useUserMap();
  const userTimezone = useUserTimezone();
  const { data: allSummaries = [] } = useAllUpdateSummaries(projectId || '');
  const { setContext, clearContext } = usePageContext();
  
  // Track scroll depth for engagement
  useScrollTracking(true);
  
  const isLoading = isLoadingProject;
  
  // Get user's email for access check
  const userEmail = user?.email?.toLowerCase();
  
  // Check if current user is the project owner (for UI permissions)
  const isOwner = useMemo(() => 
    project && userEmail && project.ownerEmail?.toLowerCase() === userEmail,
    [project, userEmail]
  );
  
  // Check if current user is a project member (for UI permissions)
  const isMember = useMemo(() => 
    project && userEmail && project.members.some((member) => 
      member.email?.toLowerCase() === userEmail || member.id?.toLowerCase() === userEmail
    ),
    [project, userEmail]
  );

  // Initialize editedProject when project loads
  useEffect(() => {
    if (project) {
      setEditedProject({
        name: project.name,
        description: project.description,
        dueDate: project.dueDate,
        status: project.status || 'active',
      });
    }
  }, [project]);
  
  // Get available users to add (exclude existing members)
  const existingMemberEmails = useMemo(() => new Set(
    project?.members.map(m => m.email?.toLowerCase() || m.id?.toLowerCase()) || []
  ), [project?.members]);
  
  const availableUsers = useMemo(() => users.filter(u => {
    const userEmailLower = u.email?.toLowerCase();
    return userEmailLower && !existingMemberEmails.has(userEmailLower);
  }), [users, existingMemberEmails]);
  
  // Filter users based on search query
  const filteredUsers = useMemo(() => availableUsers.filter(u => {
    const query = memberSearchQuery.toLowerCase();
    const fullName = `${u.firstName} ${u.lastName}`.toLowerCase();
    const email = u.email?.toLowerCase() || '';
    const jobTitle = u.jobTitle?.toLowerCase() || '';
    return fullName.includes(query) || email.includes(query) || jobTitle.includes(query);
  }), [availableUsers, memberSearchQuery]);

  // Field save handler
  const handleFieldSave = async (field: string, value: any) => {
    if (!editedProject || !project) return;

    try {
      const updatedProject = { ...editedProject, [field]: value };
      setEditedProject(updatedProject);
      
      await updateProject.mutateAsync({
        projectId: project.id,
        updates: { [field]: value },
      });

      trackUpdate('project', project.id);
      
      toast({
        title: "Success",
        description: `Project ${field} updated successfully`,
      });
      setEditingField(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : `Failed to update ${field}`,
        variant: "destructive",
      });
    }
  };

  const handleFieldCancel = () => {
    if (project) {
      setEditedProject({
        name: project.name,
        description: project.description,
        dueDate: project.dueDate,
        status: project.status || 'active',
      });
    }
    setEditingField(null);
  };

  const handleFieldClick = (field: string) => {
    if (isOwner) {
      setEditingField(field);
    }
  };
  
  // Redirect if backend returns 403 (access denied) or project not found
  useEffect(() => {
    if (!isLoading && projectError) {
      // If it's a 403 or 404, redirect to projects list
      const status = (projectError as any)?.response?.status || (projectError as any)?.status;
      if (status === 403 || status === 404) {
      navigate("/projects");
        toast({
          title: "Access Denied",
          description: "You don't have access to this project.",
          variant: "destructive",
        });
    }
    }
  }, [isLoading, projectError, navigate, toast]);

  // Reset task page index when project changes
  useEffect(() => {
    setTaskPageIndex(0);
  }, [projectId]);

  // Set page context when project loads
  useEffect(() => {
    if (project && projectId && projectId !== 'new' && project.name) {
      setContext('project', { id: projectId, title: project.name });
    } else {
      clearContext();
    }

    // Clear context on unmount
    return () => {
      clearContext();
    };
  }, [project, projectId, setContext, clearContext]);

  const handleDelete = async () => {
    if (!project) return;

    try {
      await deleteProject.mutateAsync(project.id);
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

  // Show not found if no projectId
  if (!projectId) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => navigate("/projects")}
          className="hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold">Invalid project URL</h1>
          <p className="text-muted-foreground">No project specified in the URL</p>
        </div>
      </div>
    );
  }


  // Show loading state
  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => navigate("/projects")}
          className="hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }
  
  // Show error if there was an error loading the project
  if (projectError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => navigate("/projects")}
          className="hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="text-center py-12 space-y-4">
          <h1 className="text-2xl font-bold text-destructive">Error loading project</h1>
          <p className="text-muted-foreground">
            {projectError instanceof Error ? projectError.message : 'Failed to load project'}
          </p>
        </div>
      </div>
    );
  }
  
  // Show not found if project doesn't exist (after loading completes)
  if (!project) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => navigate("/projects")}
          className="hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="text-center py-12 space-y-4">
          <h1 className="text-2xl font-bold">Project not found</h1>
          <p className="text-muted-foreground">
            Could not find a project with ID "{projectId}"
          </p>
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

  const handleAddComment = async () => {
    const comment = commentInput.trim();
    if (!comment || !project) return;
    
    try {
      await projectsService.addComment(project.id, comment);
      setCommentInput("");
      toast({
        title: "Comment added",
        description: "Your comment has been posted successfully.",
      });
      // Invalidate and refetch project to show the new comment
      queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add comment",
        variant: "destructive",
      });
    }
  };

  const handleAddMember = async () => {
    if (!project || !selectedMemberEmail) return;
    
    try {
      const selectedUserEntry = userMap.get(selectedMemberEmail.toLowerCase());
      if (!selectedUserEntry) {
        toast({
          title: "Error",
          description: "Selected user not found",
          variant: "destructive",
        });
        return;
      }
      
      const firstName = selectedUserEntry.firstName || '';
      const lastName = selectedUserEntry.lastName || '';
      const avatar = firstName && lastName 
        ? (firstName.charAt(0) + lastName.charAt(0)).toUpperCase()
        : selectedUserEntry.email?.substring(0, 2).toUpperCase() || 'U';
      
      await addMember.mutateAsync({
        projectId: project.id,
        memberEmail: selectedMemberEmail,
        role: 'member',
        avatar,
      });
      
      toast({
        title: "Member added",
        description: `${firstName} ${lastName} has been added to the project.`,
      });
      
      setShowAddMemberDialog(false);
      setSelectedMemberEmail("");
      setMemberSearchQuery("");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add member",
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async () => {
    if (!project || !memberToRemove) return;
    
    try {
      await removeMember.mutateAsync({
        projectId: project.id,
        memberEmail: memberToRemove.email,
      });
      
      toast({
        title: "Member removed",
        description: `${memberToRemove.name} has been removed from the project.`,
      });
      
      setMemberToRemove(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to remove member",
        variant: "destructive",
      });
    }
  };

  // Combine and sort activities (updates, comments, and summaries) by date
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
      ...allSummaries.map((summary, index) => ({
        id: `summary-${summary.projectId}-${summary.dateId}-${index}`,
        type: "summary" as const,
        memberName: "Lean",
        memberAvatar: "L",
        date: summary.generatedAt || summary.dateId,
        content: summary.updateSummary,
        dateId: summary.dateId,
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

  const headerActions = isOwner && project ? [
    {
      label: "Limit Visibility",
      icon: <Share2 className="h-4 w-4" />,
      onClick: () => setShowLimitVisibilityDialog(true),
    },
    {
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => setShowDeleteDialog(true),
      destructive: true,
    },
  ] : [];

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in -mt-2 sm:-mt-4">
      <div>
        <DetailPageHeader
          title={editingField === 'name' && editedProject ? editedProject.name : project.name}
          onTitleChange={editingField === 'name' && editedProject && isOwner ? (newTitle) => setEditedProject({ ...editedProject, name: newTitle }) : undefined}
          onTitleBlur={editingField === 'name' && editedProject && isOwner ? () => handleFieldSave('name', editedProject.name) : undefined}
          onTitleKeyDown={editingField === 'name' && editedProject && isOwner ? (e) => {
            if (e.key === 'Escape') {
              handleFieldCancel();
            } else if (e.key === 'Enter') {
              handleFieldSave('name', editedProject.name);
            }
          } : undefined}
          isEditingTitle={editingField === 'name' && !!editedProject && isOwner}
          onTitleClick={editingField !== 'name' && isOwner ? () => handleFieldClick('name') : undefined}
          backHref="/projects"
          actions={headerActions}
          showActions={isOwner && !!project}
        />
        {editingField === 'description' && editedProject && isOwner ? (
          <Textarea
            value={editedProject.description || ''}
            onChange={(e) => setEditedProject({ ...editedProject, description: e.target.value })}
            onBlur={() => handleFieldSave('description', editedProject.description || null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleFieldCancel();
              }
            }}
            autoFocus
            className="text-base min-h-[100px] mb-4 resize-none"
          />
        ) : (
          <p 
            className={`text-foreground text-base sm:text-lg mb-4 ${isOwner ? 'cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors' : ''} whitespace-pre-wrap`}
            onClick={() => isOwner && handleFieldClick('description')}
          >
            {editedProject?.description || 'Click to add description'}
          </p>
        )}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 text-sm text-muted-foreground mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>Created: <span className="text-foreground font-medium">{formatDate(project.createdDate)}</span></span>
          </div>
          {editingField === 'dueDate' && editedProject && isOwner ? (
            <Input
              type="date"
              value={editedProject.dueDate || ''}
              onChange={(e) => setEditedProject({ ...editedProject, dueDate: e.target.value })}
              onBlur={() => handleFieldSave('dueDate', editedProject.dueDate || null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleFieldCancel();
                }
              }}
              autoFocus
              className="h-8 text-xs"
            />
          ) : (
            <div 
              className={`flex items-center gap-2 ${isOwner ? 'cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors' : ''}`}
              onClick={() => isOwner && handleFieldClick('dueDate')}
            >
              <Calendar className="h-4 w-4" />
              <span>Due: <span className="text-foreground font-medium">{formatDateForDisplay(editedProject?.dueDate)}</span></span>
            </div>
          )}
          {editingField === 'status' && editedProject && isOwner ? (
            <Select
              value={editedProject.status || 'active'}
              onValueChange={(value) => handleFieldSave('status', value)}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div 
              className={`flex items-center gap-2 ${isOwner ? 'cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors' : ''}`}
              onClick={() => isOwner && handleFieldClick('status')}
            >
              <Badge variant={
                editedProject?.status === 'active' ? 'default' :
                editedProject?.status === 'completed' ? 'secondary' :
                editedProject?.status === 'on_hold' ? 'outline' :
                'outline'
              } className="capitalize cursor-pointer">
                {editedProject?.status ? editedProject.status.replace('_', ' ') : 'Active'}
              </Badge>
            </div>
          )}
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
                    <span>{project.members.length} members</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
                </div>
              </div>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div className="space-y-4">
                {isOwner && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddMemberDialog(true)}
                    className="w-full sm:w-auto"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Member
                  </Button>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {project.members.map((member) => {
                    const memberEmail = member.email?.toLowerCase() || member.id?.toLowerCase();
                    const isMemberOwner = project.ownerEmail?.toLowerCase() === memberEmail;
                    const canRemove = isOwner || (memberEmail === userEmail && !isMemberOwner);
                    
                    return (
                      <div key={member.id} className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border relative group">
                        <Avatar>
                          <AvatarFallback className={getAvatarColor(member.email || member.name || member.id)}>
                            {member.avatar}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm truncate">{member.name}</p>
                            {isMemberOwner && (
                              <Badge variant="secondary" className="text-xs">
                                Owner
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{member.role || 'member'}</p>
                        </div>
                        {canRemove && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setMemberToRemove({ email: member.email || member.id, name: member.name })}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                <div className="w-full bg-secondary rounded-full h-2 relative">
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
              <div className="mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewTaskDialog(true)}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Task
                </Button>
              </div>
              {project.tasks.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No tasks yet
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {project.tasks.slice(taskPageIndex * 5, (taskPageIndex + 1) * 5).map((task) => (
                      <div 
                        key={task.id} 
                        className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border cursor-pointer hover:bg-background/70 transition-colors"
                        onClick={() => navigate(`/tasks/${task.id}`)}
                      >
                        {task.reason && (
                          <div className="flex-shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                            <TaskTooltip taskId={task.id} taskReason={task.reason} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm">{task.title}</p>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>Assignee: {task.assignee || "Unassigned"}</span>
                            <span>Due: {formatDateForDisplay(task.dueDate)}</span>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize flex-shrink-0">
                          {task.status.replace("-", " ")}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {project.tasks.length > 5 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                      <div className="text-sm text-muted-foreground">
                        Showing {taskPageIndex * 5 + 1}-{Math.min((taskPageIndex + 1) * 5, project.tasks.length)} of {project.tasks.length} tasks
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setTaskPageIndex(prev => Math.max(0, prev - 1))}
                          disabled={taskPageIndex === 0}
                          className="h-8 w-8"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setTaskPageIndex(prev => prev + 1)}
                          disabled={(taskPageIndex + 1) * 5 >= project.tasks.length}
                          className="h-8 w-8"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
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
                            : activity.type === "summary"
                            ? "border-purple-500/50"
                            : "border-muted-foreground/20"
                        }`}
                      >
                        <div className="flex items-start gap-3 mb-2">
                          <Avatar className="h-8 w-8">
                            {activity.type === "summary" ? (
                              <>
                                <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {activity.memberAvatar}
                                </AvatarFallback>
                              </>
                            ) : (
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {activity.memberAvatar}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm">{activity.memberName}</p>
                                {activity.type === "comment" && (
                                  <Badge 
                                    className="bg-blue-500/10 text-blue-700  border-blue-500/20 text-xs flex items-center gap-1"
                                    variant="outline"
                                  >
                                    <MessageSquare className="h-3 w-3" />
                                    <span>comment</span>
                                  </Badge>
                                )}
                                {activity.type === "update" && (
                                  <Badge 
                                    className="bg-green-500/10 text-green-700  border-green-500/20 text-xs flex items-center gap-1"
                                    variant="outline"
                                  >
                                    <Activity className="h-3 w-3" />
                                    <span>update</span>
                                  </Badge>
                                )}
                                {activity.type === "summary" && (
                                  <Badge 
                                    className="bg-purple-500/10 text-purple-700  border-purple-500/20 text-xs flex items-center gap-1"
                                    variant="outline"
                                  >
                                    <Sparkles className="h-3 w-3" />
                                    <span>AI summary</span>
                                  </Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {typeof activity.date === 'string' 
                                  ? formatDateStringInTimezone(activity.date, userTimezone)
                                  : formatDate(activity.date)}
                              </span>
                            </div>
                            <div className="relative">
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{activity.content}</p>
                            </div>
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

      {/* Add Member Dialog */}
      <Dialog open={showAddMemberDialog} onOpenChange={setShowAddMemberDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Project Member</DialogTitle>
            <DialogDescription>
              Select a user from your domain to add to this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Popover open={memberPopoverOpen} onOpenChange={setMemberPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={memberPopoverOpen}
                  className="w-full justify-between"
                >
                  {selectedMemberEmail
                    ? (() => {
                        const userEntry = userMap.get(selectedMemberEmail.toLowerCase());
                        return userEntry 
                          ? `${userEntry.firstName} ${userEntry.lastName}`.trim() || selectedMemberEmail
                          : selectedMemberEmail;
                      })()
                    : "Select a user..."}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput 
                    placeholder="Search users..." 
                    value={memberSearchQuery}
                    onValueChange={setMemberSearchQuery}
                  />
                  <CommandList>
                    {filteredUsers.length === 0 ? (
                      <CommandEmpty>No users found.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {filteredUsers.map((user) => {
                          const isSelected = selectedMemberEmail === user.email?.toLowerCase();
                          const firstName = user.firstName || '';
                          const lastName = user.lastName || '';
                          const fullName = `${firstName} ${lastName}`.trim() || user.email;
                          const avatar = firstName && lastName 
                            ? (firstName.charAt(0) + lastName.charAt(0)).toUpperCase()
                            : user.email?.substring(0, 2).toUpperCase() || 'U';
                          
                          return (
                            <CommandItem
                              key={user.email}
                              value={user.email}
                              onSelect={() => {
                                setSelectedMemberEmail(user.email?.toLowerCase() || '');
                                setMemberPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 shrink-0 ${
                                  isSelected ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <Avatar className="h-6 w-6 shrink-0">
                                  <AvatarFallback className={getAvatarColor(user.email || '')}>
                                    {avatar}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium truncate">{fullName}</span>
                                  <span className="text-xs text-muted-foreground truncate">
                                    {user.email} {user.jobTitle ? `• ${user.jobTitle}` : ''}
                                  </span>
                                </div>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddMemberDialog(false);
                  setSelectedMemberEmail("");
                  setMemberSearchQuery("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddMember}
                disabled={!selectedMemberEmail || addMember.isPending}
              >
                {addMember.isPending ? "Adding..." : "Add Member"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation Dialog */}
      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{memberToRemove?.name}" from this project? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMemberToRemove(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeMember.isPending}
            >
              {removeMember.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Task Dialog */}
      <NewTaskDialog 
        open={showNewTaskDialog} 
        onOpenChange={setShowNewTaskDialog}
        initialProjectId={project.id}
      />

      {/* Limit Visibility Dialog */}
      {project && (
        <LimitVisibilityDialog
          open={showLimitVisibilityDialog}
          onOpenChange={setShowLimitVisibilityDialog}
          title="Limit Project Visibility"
          itemName={project.name}
          currentVisibility={project.visibility || 'all_members'}
          currentVisibleToMembers={project.visibleToMembers || []}
          onSave={async (newVisibility, newVisibleToMembers) => {
            const oldVisibility = project.visibility || 'all_members';
            await updateProject.mutateAsync({
              projectId: project.id,
              updates: {
                visibility: newVisibility,
                visibleToMembers: newVisibleToMembers,
              },
            });
            
            // Track project update
            trackUpdate('project', project.id);
            
            // Track visibility change if it changed
            if (oldVisibility !== newVisibility) {
              trackEvent('project_visibility_changed', {
                project_id: project.id,
                old_visibility: oldVisibility,
                new_visibility: newVisibility,
              });
            }
            
            toast({
              title: "Visibility updated",
              description: "Project visibility has been updated successfully.",
            });
          }}
        />
      )}
    </div>
  );
}
