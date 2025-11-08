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
import { useUserTeams } from "@/hooks/useTeams";
import { useUsers } from "@/hooks/useUsers";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, parse } from "date-fns";
import { useState, useEffect } from "react";

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
      return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
    case "in-progress":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
    case "review":
      return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20";
    case "blocked":
      return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
    default:
      return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
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
      return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
    case "blocker":
      return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
    case "question":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
    default:
      return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
  }
};

// Get all unique team members from projects
const getAllTeamMembers = (projects: any[]) => {
  const memberMap = new Map<string, { name: string; avatar: string; role: string }>();
  
  // Collect from project members
  projects.forEach(project => {
    project.members?.forEach((member: any) => {
      if (!memberMap.has(member.name)) {
        memberMap.set(member.name, {
          name: member.name,
          avatar: member.avatar,
          role: member.role,
        });
      }
    });
  });
  
  // Also include team members from TeamDetail teamData
  const teamDataMembers = [
    { name: "Sarah Johnson", avatar: "SJ", role: "Team Lead" },
    { name: "Michael Chen", avatar: "MC", role: "Senior Developer" },
    { name: "Alex Rivera", avatar: "AR", role: "Frontend Developer" },
    { name: "David Kim", avatar: "DK", role: "Backend Developer" },
    { name: "Emma Davis", avatar: "ED", role: "Design Lead" },
    { name: "Sophie Turner", avatar: "ST", role: "UI Designer" },
    { name: "Lucas Brown", avatar: "LB", role: "UX Researcher" },
    { name: "James Wilson", avatar: "JW", role: "Product Manager" },
    { name: "Olivia Martinez", avatar: "OM", role: "Product Owner" },
    { name: "Ryan Taylor", avatar: "RT", role: "Marketing Lead" },
    { name: "Nina Patel", avatar: "NP", role: "Content Strategist" },
  ];
  
  teamDataMembers.forEach(member => {
    if (!memberMap.has(member.name)) {
      memberMap.set(member.name, member);
    }
  });
  
  return Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export default function TaskDetail() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [commentInput, setCommentInput] = useState("");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editedTask, setEditedTask] = useState<Task | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeJustSelected, setAssigneeJustSelected] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  
  const { data: task, isLoading } = useTask(taskId || '');
  const { data: projects = [] } = useUserProjects();
  const { data: userTeams = [] } = useUserTeams();
  const { data: users = [] } = useUsers();
  
  // Check if user has access to the task
  const hasAccess = task ? (() => {
    // If task has a project, check if user has access to that project
    if (task.project || task.projectId) {
      return projects.some((project) => {
        const projectName = project.name.toLowerCase();
        const taskProjectName = (task.project?.toLowerCase() || task.projectId?.toLowerCase());
        return taskProjectName && projectName === taskProjectName;
      });
    }
    
    // If task has no project, check if it's associated with user's teams
    if (task.teams && task.teams.length > 0) {
      const userTeamNames = new Set(userTeams.map(team => team.name.toLowerCase()));
      return task.teams.some(teamName => userTeamNames.has(teamName.toLowerCase()));
    }
    
    return false;
  })() : false;
  
  // Redirect if user doesn't have access
  useEffect(() => {
    if (!isLoading && task && !hasAccess) {
      navigate("/tasks");
    }
  }, [isLoading, task, hasAccess, navigate]);
  const updateTaskMutation = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();
  const teamMembers = getAllTeamMembers(projects);

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
      setEditedTask({ ...task });
    }
  }, [task]);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/tasks")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tasks
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading task...</p>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/tasks")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tasks
        </Button>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold">Task not found</h1>
        </div>
      </div>
    );
  }

  // Show access denied if user doesn't have access
  if (task && projects.length > 0 && !hasAccess && !isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/tasks")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tasks
        </Button>
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
    const slug = task.projectId.toLowerCase().replace(/\s+/g, '-');
    navigate(`/projects/${slug}`);
  };

  const handleDelete = async () => {
    if (!task || !taskId) return;

    try {
      await deleteTask.mutateAsync(taskId);
      toast({
        title: "Task deleted",
        description: `"${task.title}" has been deleted successfully.`,
      });
      navigate("/tasks");
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
    setEditingField(null);
  };

  const handleFieldCancel = () => {
    if (task) {
      setEditedTask({ ...task });
    }
    setEditingField(null);
  };

  const handleFieldClick = (field: string) => {
    setEditingField(field);
    if (field === 'assignee') {
      setAssigneeOpen(true);
    } else if (field === 'dueDate') {
      setDueDateOpen(true);
    }
  };

  // Parse date string to Date object
  const parseDateString = (dateString: string): Date | undefined => {
    try {
      return parse(dateString, "MMM d, yyyy", new Date());
    } catch {
      return undefined;
    }
  };

  // Format Date object to date string
  const formatDateString = (date: Date): string => {
    return format(date, "MMM d, yyyy");
  };

  // Combine and sort activities (updates and comments) by date
  const getActivities = () => {
    const activities = [
      ...task.progressUpdates.map(update => ({
        id: update.id,
        type: "update" as const,
        memberName: update.memberName,
        memberAvatar: update.memberAvatar,
        date: update.date,
        content: update.update,
        updateType: update.type,
      })),
      ...task.comments.map(comment => ({
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
      <Button variant="ghost" onClick={() => navigate("/tasks")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Tasks
      </Button>

      <div>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-start gap-3 flex-1">
            <div className="mt-1">
              {getStatusIcon(task.status)}
            </div>
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
          <div className="flex items-center gap-2">
            <Badge 
              className={`${getPriorityColor(task.priority)} text-xs cursor-pointer`}
              variant="outline"
              onClick={() => handleFieldClick('priority')}
            >
              {task.priority}
            </Badge>
            <Badge 
              className={`${getStatusColor(task.status)} text-xs cursor-pointer`}
              variant="outline"
              onClick={() => handleFieldClick('status')}
            >
              {task.status.replace("-", " ")}
            </Badge>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Task
            </Button>
          </div>
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
            className="text-muted-foreground text-lg mb-4 cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
            onClick={() => handleFieldClick('description')}
          >
            {task.description}
          </p>
        )}
        
        {/* Task Meta Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="mr-2">Assignee:</span>
            {editingField === 'assignee' && editedTask ? (
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
                          {teamMembers.find(m => m.name === editedTask.assignee)?.avatar || editedTask.assigneeAvatar}
                        </AvatarFallback>
                      </Avatar>
                      <span>{editedTask.assignee || "Select assignee..."}</span>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder="Search team members..." />
                    <CommandList>
                      <CommandEmpty>No team member found.</CommandEmpty>
                      <CommandGroup>
                        {teamMembers.map((member) => (
                          <CommandItem
                            key={member.name}
                            value={member.name}
                            onSelect={() => {
                              const selectedMember = teamMembers.find(m => m.name === member.name);
                              if (selectedMember) {
                                setAssigneeJustSelected(true);
                                handleFieldSave('assignee', selectedMember.name, { assigneeAvatar: selectedMember.avatar });
                                setAssigneeOpen(false);
                              }
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                editedTask.assignee === member.name ? "opacity-100" : "opacity-0"
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
                    {task.assigneeAvatar}
                  </AvatarFallback>
                </Avatar>
                <span 
                  className="text-foreground font-medium cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                  onClick={() => handleFieldClick('assignee')}
                >
                  {task.assignee}
                </span>
              </div>
            )}
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
                    {editedTask.dueDate ? editedTask.dueDate : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={parseDateString(editedTask.dueDate)}
                    onSelect={(date) => {
                      if (date) {
                        const formattedDate = formatDateString(date);
                        handleFieldSave('dueDate', formattedDate);
                        setDueDateOpen(false);
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <span 
                className="text-foreground font-medium cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                onClick={() => handleFieldClick('dueDate')}
              >
                {task.dueDate}
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

        {/* Status and Priority Dropdowns */}
        {(editingField === 'status' || editingField === 'priority') && editedTask && (
          <div className="mb-4 p-4 border rounded-lg bg-muted/50">
            {editingField === 'status' && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editedTask.status}
                  onValueChange={(value) => {
                    handleFieldSave('status', value as Task["status"]);
                  }}
                  onOpenChange={(open) => {
                    if (!open && editingField === 'status') {
                      setEditingField(null);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">Todo</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {editingField === 'priority' && (
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={editedTask.priority}
                  onValueChange={(value) => {
                    handleFieldSave('priority', value as Task["priority"]);
                  }}
                  onOpenChange={(open) => {
                    if (!open && editingField === 'priority') {
                      setEditingField(null);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {editingField === 'tags' && editedTask ? (
          <div className="mb-4">
            <Input
              value={editedTask.tags.join(', ')}
              onChange={(e) => {
                const tags = e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                setEditedTask({ ...editedTask, tags });
              }}
              onBlur={() => handleFieldSave('tags', editedTask.tags)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleFieldSave('tags', editedTask.tags);
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
            {task.tags.length > 0 ? (
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
                    Activities ({task.progressUpdates.length + task.comments.length})
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
                        className={`border-l-2 pl-4 pb-4 last:pb-0 relative ${
                          activity.type === "update" 
                            ? "border-primary/30" 
                            : "border-muted-foreground/20"
                        }`}
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
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-sm">{activity.memberName}</p>
                              <span className="text-xs text-muted-foreground">{activity.date}</span>
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
                                  className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 text-xs flex items-center gap-1"
                                  variant="outline"
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  <span>comment</span>
                                </Badge>
                              )}
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

