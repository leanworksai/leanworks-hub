import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { 
  ArrowLeft, 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle, 
  FileCheck,
  Calendar,
  User,
  Tag,
  TrendingUp,
  MessageSquare,
  AlertTriangle,
  Flag,
  ChevronDown,
  Send,
  Activity,
  ArrowRight,
  Check,
  ChevronsUpDown,
  Trash2
} from "lucide-react";
import { Task } from "@/data/tasksData";
import { useTask, useUpdateTask, useDeleteTask } from "@/hooks/useTasks";
import { useToast } from "@/hooks/use-toast";
import { useUserProjects } from "@/hooks/useProjects";
import { useUsers } from "@/hooks/useUsers";
import { useSubscription } from "@/hooks/useSubscription";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useDateSelection } from "@/hooks/useDateSelection";

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const getStatusIcon = (status: Task["status"]) => {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "in-progress":
      return <Clock className="h-4 w-4 text-blue-500" />;
    case "review":
      return <FileCheck className="h-4 w-4 text-yellow-500" />;
    case "blocked":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
};

const getStatusColor = (status: Task["status"]) => {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-700  border-green-500/20";
    case "in-progress":
      return "bg-blue-500/10 text-blue-700  border-blue-500/20";
    case "review":
      return "bg-yellow-500/10 text-yellow-700  border-yellow-500/20";
    case "blocked":
      return "bg-red-500/10 text-red-700  border-red-500/20";
    default:
      return "bg-gray-500/10 text-gray-700  border-gray-500/20";
  }
};

const getPriorityColor = (priority: Task["priority"]) => {
  switch (priority) {
    case "urgent":
      return "bg-red-500 text-white";
    case "high":
      return "bg-orange-500 text-white";
    case "medium":
      return "bg-yellow-500 text-white";
    default:
      return "bg-gray-500 text-white";
  }
};

const getUpdateTypeIcon = (type?: string) => {
  switch (type) {
    case "milestone":
      return <Flag className="h-3 w-3" />;
    case "blocker":
      return <AlertTriangle className="h-3 w-3" />;
    case "question":
      return <MessageSquare className="h-3 w-3" />;
    default:
      return <TrendingUp className="h-3 w-3" />;
  }
};

const getUpdateTypeColor = (type?: string) => {
  switch (type) {
    case "milestone":
      return "bg-purple-500/10 text-purple-700  border-purple-500/20";
    case "blocker":
      return "bg-red-500/10 text-red-700  border-red-500/20";
    case "question":
      return "bg-blue-500/10 text-blue-700  border-blue-500/20";
    default:
      return "bg-green-500/10 text-green-700  border-green-500/20";
  }
};

// Get all unique team members from projects, or all org users if task has no project
const getAllTeamMembers = (projects: any[], users: any[] = [], task?: any) => {
  const memberMap = new Map<string, { id?: string; name: string; avatar: string; role: string }>();
  
  // If task has a project, collect from project members
  const taskProjectId = task?.projectId;
  const taskProjectName = task?.project;
  
  if (taskProjectId || taskProjectName) {
    // Find the project by ID or name
    const taskProject = projects.find(p => 
      p.id === taskProjectId || 
      p.name === taskProjectId || 
      p.name === taskProjectName
    );
    
    if (taskProject?.members) {
      taskProject.members.forEach((member: any) => {
      if (!memberMap.has(member.name)) {
        memberMap.set(member.name, {
            id: member.id || member.email, // Include the ID (email address)
          name: member.name,
          avatar: member.avatar,
          role: member.role,
        });
      }
    });
    }
  } else {
    // No project - use all org users
    users.forEach(user => {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
      if (!memberMap.has(name)) {
        memberMap.set(name, {
          id: user.email.toLowerCase(),
          name: name,
          avatar: `${(user.firstName || '').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || user.email.charAt(0).toUpperCase(),
          role: user.jobTitle || 'Member',
        });
    }
  });
  }
  
  return Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
};

interface TaskDetailProps {
  taskId?: string;
  onClose?: () => void;
  isDialog?: boolean;
}

export default function TaskDetail({ taskId: propTaskId, onClose, isDialog = false }: TaskDetailProps = {}) {
  const { taskId: paramTaskId } = useParams();
  const navigate = useNavigate();
  const taskId = propTaskId || paramTaskId;
  const [commentInput, setCommentInput] = useState("");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editedTask, setEditedTask] = useState<Task | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeJustSelected, setAssigneeJustSelected] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  
  const { data: task, isLoading } = useTask(taskId || '');
  const { data: projects = [] } = useUserProjects();
  const { data: users = [] } = useUsers();
  const { isFreePlan } = useSubscription();
  const { parseDateString, formatDateString, formatDateForDisplay, handleDateSelection } = useDateSelection();
  
  // Check if user has access to the task
  const hasAccess = task ? (() => {
    // If task has a projectId, check if user has access to that project
    if (task.projectId) {
      // First try matching by ID (UUID format)
      const hasProjectAccessById = projects.some((project) => project.id === task.projectId);
      if (hasProjectAccessById) {
        return true;
      }
      
      // If ID match fails, try matching by name (for legacy tasks where projectId is actually a name)
      const hasProjectAccessByName = projects.some((project) => project.name === task.projectId);
      if (hasProjectAccessByName) return true;
      
      // Task has a project but user doesn't have access
      return false;
    }
    
    // If task has a project name (legacy), try to find it by name
    if (task.project) {
      const hasProjectAccess = projects.some((project) => project.name === task.project);
      if (hasProjectAccess) return true;
    
      // Task has a project but user doesn't have access
      return false;
    }
    
    // If task has no project, it's visible to all org members
    return true;
  })() : false;
  
  // Redirect if user doesn't have access (only after both task and projects are loaded)
  // Don't redirect if in dialog mode - let the dialog handle closing
  useEffect(() => {
    if (!isLoading && task && !hasAccess && !isDialog) {
      navigate("/tasks");
    } else if (!isLoading && task && !hasAccess && isDialog && onClose) {
      onClose();
    }
  }, [isLoading, task, hasAccess, navigate, projects.length, isDialog, onClose]);
  const updateTaskMutation = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();
  const teamMembers = getAllTeamMembers(projects, users, task);

  // Find creator user from users list
  const creator = task?.createdBy 
    ? users.find(user => user.email === task.createdBy)
    : null;
  
  const getCreatorInitials = () => {
    if (creator) {
      const first = creator.firstName?.charAt(0).toUpperCase() || '';
      const last = creator.lastName?.charAt(0).toUpperCase() || '';
      return first + last || 'U';
    }
    return 'U';
  };
  
  const getCreatorDisplayName = () => {
    if (creator) {
      if (creator.firstName && creator.lastName) {
        return `${creator.firstName} ${creator.lastName}`;
      }
      return creator.email;
    }
    return task?.createdBy || 'Unknown';
  };
  
  // Update editedTask when task changes
  useEffect(() => {
    if (task) {
      setEditedTask({ 
        ...task,
        tags: task.tags || [], // Ensure tags is always an array
        progressUpdates: task.progressUpdates || [],
        comments: task.comments || [],
      });
    }
  }, [task]);

  const handleBack = () => {
    if (onClose) {
      onClose();
    } else {
      navigate("/tasks");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        {!isDialog && (
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tasks
          </Button>
        )}
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading task...</p>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-6 animate-fade-in">
        {!isDialog && (
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tasks
          </Button>
        )}
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold">Task not found</h1>
        </div>
      </div>
    );
  }

  // Show access denied if user doesn't have access (wait for projects to load)
  if (task && !hasAccess && !isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        {!isDialog && (
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tasks
          </Button>
        )}
        <div className="text-center py-12">
          <p className="text-muted-foreground">You don't have access to this task.</p>
        </div>
      </div>
    );
  }

  const handleAddComment = () => {
    const comment = commentInput.trim();
    if (!comment) return;
    
    // In a real app, this would send to an API
    // For now, we'll just clear the input
    setCommentInput("");
  };

  const handleProjectClick = () => {
    if (task.projectId) {
      navigate(`/projects/${task.projectId}`);
    }
  };

  const handleDelete = async () => {
    if (!task || !taskId) return;

    try {
      await deleteTask.mutateAsync(taskId);
      toast({
        title: "Task deleted",
        description: `"${task.title}" has been deleted successfully.`,
      });
      if (onClose) {
        onClose();
      } else {
        navigate("/tasks");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  const handleFieldSave = async (field: keyof Task, value: any, additionalData?: Record<string, any>) => {
    if (!editedTask || !taskId) return;
    
    const updatedTask = { ...editedTask, [field]: value, ...additionalData };
    setEditedTask(updatedTask);
    await updateTaskMutation.mutateAsync({ 
      taskId, 
      updates: { [field]: value, ...additionalData } 
    });
    // Keep editedTask updated so it persists after edit mode ends
    // The task will refetch automatically via query invalidation
    setEditingField(null);
  };

  const handleFieldCancel = () => {
    if (task) {
      setEditedTask({ 
        ...task,
        tags: task.tags || [], // Ensure tags is always an array
        progressUpdates: task.progressUpdates || [],
        comments: task.comments || [],
      });
    }
    setEditingField(null);
  };

  const handleFieldClick = (field: string) => {
    setEditingField(field);
    if (field === 'assigneeId') {
      setAssigneeOpen(true);
    } else if (field === 'dueDate') {
      setDueDateOpen(true);
    }
  };


  // Combine and sort activities (updates and comments) by date
  const getActivities = () => {
    const activities = [
      ...(task.progressUpdates || []).map(update => ({
        id: update.id,
        type: "update" as const,
        memberName: update.memberName,
        memberAvatar: update.memberAvatar,
        date: update.date,
        content: update.update,
        updateType: update.type,
      })),
      ...(task.comments || []).map(comment => ({
        id: comment.id,
        type: "comment" as const,
        memberName: comment.memberName,
        memberAvatar: comment.memberAvatar,
        date: comment.date,
        content: comment.comment,
        updateType: undefined,
      })),
    ];
    
    // Sort by date (newest first)
    return activities.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {!isDialog && (
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tasks
        </Button>
      )}

      <div>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-start gap-3 flex-1">
            <div className="flex-1">
              {editingField === 'title' && editedTask ? (
                <Input
                  value={editedTask.title}
                  onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                  onBlur={() => handleFieldSave('title', editedTask.title)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleFieldSave('title', editedTask.title);
                    } else if (e.key === 'Escape') {
                      handleFieldCancel();
                    }
                  }}
                  autoFocus
                  className="text-3xl font-bold h-auto py-2"
                />
              ) : (
                <h1 
                  className="text-3xl font-bold tracking-tight cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                  onClick={() => handleFieldClick('title')}
                >
                  {task.title}
                </h1>
              )}
            </div>
          </div>
          {/* Delete button on right when NOT in dialog mode */}
          {!isDialog && (
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        {editingField === 'description' && editedTask ? (
          <Textarea
            value={editedTask.description}
            onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
            onBlur={() => handleFieldSave('description', editedTask.description)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleFieldCancel();
              }
            }}
            autoFocus
            className="text-lg min-h-[100px] mb-4"
          />
        ) : (
          <p 
            className="text-foreground text-lg mb-4 cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors whitespace-pre-wrap"
            onClick={() => handleFieldClick('description')}
          >
            {task.description}
          </p>
        )}

        {/* Reason Section - only show if reason is not empty */}
        {task.reason && task.reason.trim() && (
          <Card className="bg-gradient-card border-border shadow-card mb-4">
            <CardContent className="pt-6">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide">Reason</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.reason}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Task Meta Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="mr-2">Assignee:</span>
            {editingField === 'assigneeId' && editedTask ? (
              <Popover open={assigneeOpen} onOpenChange={(open) => {
                setAssigneeOpen(open);
                if (!open && !assigneeJustSelected) {
                  // If popover closes without selection, cancel editing
                  handleFieldCancel();
                }
                setAssigneeJustSelected(false);
              }}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={assigneeOpen}
                    className="w-[250px] justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {editedTask.assigneeAvatar || (editedTask.assignee ? getInitials(editedTask.assignee) : "?")}
                        </AvatarFallback>
                      </Avatar>
                      <span>{editedTask.assignee || "Select assignee..."}</span>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder={(task?.projectId || task?.project) ? "Search project members..." : "Search organization members..."} />
                    <CommandList>
                      <CommandEmpty>
                        {(task?.projectId || task?.project) ? "No project member found." : "No organization member found."}
                      </CommandEmpty>
                      <CommandGroup>
                        {teamMembers.map((member) => (
                          <CommandItem
                            key={member.name}
                            value={member.name}
                            onSelect={() => {
                              const selectedMember = teamMembers.find(m => m.name === member.name);
                              if (selectedMember && selectedMember.id) {
                                setAssigneeJustSelected(true);
                                handleFieldSave('assigneeId', selectedMember.id, {
                                  assigneeName: selectedMember.name,
                                  assignee: selectedMember.name, // Also keep assignee for frontend display
                                  assigneeAvatar: selectedMember.avatar
                                });
                                setAssigneeOpen(false);
                              }
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                editedTask.assigneeId === member.id ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            <div className="flex items-center gap-2 flex-1">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {member.avatar}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <span>{member.name}</span>
                                <span className="text-xs text-muted-foreground">{member.role}</span>
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {(editedTask?.assigneeAvatar || task.assigneeAvatar) || ((editedTask?.assignee || task.assignee) ? getInitials(editedTask?.assignee || task.assignee || "") : "?")}
                  </AvatarFallback>
                </Avatar>
                <span 
                  className="text-foreground font-medium cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                  onClick={() => handleFieldClick('assigneeId')}
                >
                  {editedTask?.assignee || task.assignee || "Unassigned"}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="mr-2">Status:</span>
            <Popover open={statusOpen} onOpenChange={setStatusOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex items-center border-0 bg-transparent p-0">
                  <Badge 
                    className={`${getStatusColor(task.status)} text-xs cursor-pointer`}
                    variant="outline"
                  >
                    {task.status.replace("-", " ")}
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                  <CommandList>
                    <CommandGroup>
                      {(["todo", "in-progress", "review", "blocked", "completed"] as const).map((status) => (
                        <CommandItem
                          key={status}
                          value={status}
                          onSelect={() => {
                            handleFieldSave('status', status);
                            setStatusOpen(false);
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              task.status === status ? "opacity-100" : "opacity-0"
                            }`}
                          />
                          {status.replace("-", " ")}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="mr-2">Priority:</span>
            <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex items-center border-0 bg-transparent p-0">
                  <Badge 
                    className={`${getPriorityColor(task.priority)} text-xs cursor-pointer`}
                    variant="outline"
                  >
                    {task.priority}
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                  <CommandList>
                    <CommandGroup>
                      {(["low", "medium", "high", "urgent"] as const).map((priority) => (
                        <CommandItem
                          key={priority}
                          value={priority}
                          onSelect={() => {
                            handleFieldSave('priority', priority);
                            setPriorityOpen(false);
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              task.priority === priority ? "opacity-100" : "opacity-0"
                            }`}
                          />
                          {priority}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span className="mr-2">Due Date:</span>
            {editingField === 'dueDate' && editedTask ? (
              <Popover open={dueDateOpen} onOpenChange={(open) => {
                setDueDateOpen(open);
                if (!open) {
                  setEditingField(null);
                }
              }}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[200px] justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {formatDateForDisplay(editedTask.dueDate) || "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={parseDateString(editedTask.dueDate)}
                    onSelect={(date) => {
                      if (date) {
                        handleDateSelection(date, (serverFormat) => {
                          // Update local state with server format (will be formatted for display)
                          setEditedTask({ ...editedTask, dueDate: serverFormat });
                          // Save to server in YYYY-MM-DD format
                          handleFieldSave('dueDate', serverFormat);
                          setDueDateOpen(false);
                        });
                      }
                    }}
                    initialFocus
                  />
                  {editedTask.dueDate && (
                    <div className="p-3 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          setEditedTask({ ...editedTask, dueDate: undefined });
                          handleFieldSave('dueDate', null);
                          setDueDateOpen(false);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove due date
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
              <span 
                className="text-foreground font-medium cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                onClick={() => handleFieldClick('dueDate')}
              >
                {formatDateForDisplay(task.dueDate)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span className="mr-2">Created:</span>
            <span className="text-foreground font-medium">{task.createdDate}</span>
          </div>
          {task.createdBy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span className="mr-2">Created by:</span>
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {getCreatorInitials()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-foreground font-medium">{getCreatorDisplayName()}</span>
              </div>
            </div>
          )}
          {task.estimatedHours && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="mr-2">Time:</span>
              {editingField === 'hours' && editedTask ? (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={editedTask.actualHours || ''}
                    onChange={(e) => setEditedTask({ ...editedTask, actualHours: e.target.value ? parseInt(e.target.value) : undefined })}
                    onBlur={() => handleFieldSave('actualHours', editedTask.actualHours)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleFieldSave('actualHours', editedTask.actualHours);
                      } else if (e.key === 'Escape') {
                        handleFieldCancel();
                      }
                    }}
                    autoFocus
                    className="w-16"
                  />
                  <span>/</span>
                  <Input
                    type="number"
                    value={editedTask.estimatedHours || ''}
                    onChange={(e) => setEditedTask({ ...editedTask, estimatedHours: e.target.value ? parseInt(e.target.value) : undefined })}
                    onBlur={() => handleFieldSave('estimatedHours', editedTask.estimatedHours)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleFieldSave('estimatedHours', editedTask.estimatedHours);
                      } else if (e.key === 'Escape') {
                        handleFieldCancel();
                      }
                    }}
                    className="w-16"
                  />
                  <span>h</span>
                </div>
              ) : (
                <span 
                  className="text-foreground font-medium cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                  onClick={() => handleFieldClick('hours')}
                >
                  {task.actualHours || 0}h / {task.estimatedHours}h
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="mr-2">Project:</span>
            <button
              onClick={handleProjectClick}
              className="flex items-center gap-1 text-primary hover:underline font-medium"
            >
              <span>{task.project}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Tags */}
        {editingField === 'tags' && editedTask ? (
          <div className="mb-4">
            <Input
              value={(editedTask.tags || []).join(', ')}
              onChange={(e) => {
                const tags = e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                setEditedTask({ ...editedTask, tags });
              }}
              onBlur={() => handleFieldSave('tags', editedTask.tags || [])}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleFieldSave('tags', editedTask.tags || []);
                } else if (e.key === 'Escape') {
                  handleFieldCancel();
                }
              }}
              autoFocus
              placeholder="Enter tags separated by commas"
              className="mb-2"
            />
          </div>
        ) : (
          <div 
            className="flex flex-wrap gap-2 mb-4 cursor-pointer hover:bg-muted/50 rounded p-2 -mx-2 transition-colors"
            onClick={() => handleFieldClick('tags')}
          >
            {task.tags && task.tags.length > 0 ? (
              task.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  <Tag className="h-3 w-3 mr-1" />
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Click to add tags</span>
            )}
          </div>
        )}
      </div>

      {/* Activities Section */}
      <Card className="bg-gradient-card border-border shadow-card">
        <Collapsible defaultOpen={true}>
          <CardHeader>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center justify-between hover:opacity-80 transition-opacity cursor-pointer">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-xl">
                    Activities ({(task.progressUpdates?.length || 0) + (task.comments?.length || 0)})
                  </CardTitle>
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
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                    {getActivities().map((activity) => (
                      <div 
                        key={activity.id} 
                        className={cn(
                          `border-l-2 pl-4 pb-4 last:pb-0 relative ${
                            activity.type === "update" 
                              ? "border-primary/30" 
                              : "border-muted-foreground/20"
                          }`,
                          isFreePlan && activity.type === "update" && "blur-sm pointer-events-none"
                        )}
                      >
                        <div className={`absolute -left-2 top-0 h-4 w-4 rounded-full bg-background border-2 ${
                          activity.type === "update"
                            ? "border-primary/50"
                            : "border-muted-foreground/30"
                        }`} />
                        <div className="flex items-start gap-3 mb-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {activity.memberAvatar}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm">{activity.memberName}</p>
                                {activity.type === "update" && activity.updateType && (
                                  <Badge 
                                    className={`${getUpdateTypeColor(activity.updateType)} text-xs flex items-center gap-1`}
                                    variant="outline"
                                  >
                                    {getUpdateTypeIcon(activity.updateType)}
                                    <span>{activity.updateType}</span>
                                  </Badge>
                                )}
                                {activity.type === "comment" && (
                                  <Badge 
                                    className="bg-blue-500/10 text-blue-700  border-blue-500/20 text-xs flex items-center gap-1"
                                    variant="outline"
                                  >
                                    <MessageSquare className="h-3 w-3" />
                                    <span>comment</span>
                                  </Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">{activity.date}</span>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {activity.content}
                            </p>
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
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{task?.title}"? This action cannot be undone.
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

