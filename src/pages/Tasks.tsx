import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { 
  Plus, 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle, 
  FileCheck,
  Calendar,
  User,
  ArrowRight,
  Trash2,
  Sparkles,
  Check,
  ChevronsUpDown,
  Share2,
  Edit,
  X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Task } from "@/data/tasksData";
import { useState, useMemo, useCallback } from "react";
import { useUserTasks, useDeleteTask, useUpdateTask } from "@/hooks/useTasks";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { useToast } from "@/hooks/use-toast";
import { useUsers } from "@/hooks/useUsers";
import { useUserMap } from "@/hooks/useUserMap";
import { useUserProjects } from "@/hooks/useProjects";
import { useSubscription } from "@/hooks/useSubscription";
import { useDateSelection } from "@/hooks/useDateSelection";
import { cn } from "@/lib/utils";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { useAuth } from "@/contexts/AuthContext";
import { MoreOptionsMenu } from "@/components/MoreOptionsMenu";
import { trackUpdate, trackEvent } from "@/lib/analytics";

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
      return "bg-green-500/10 text-green-700 border-green-500/20";
    case "in-progress":
      return "bg-blue-500/10 text-blue-700 border-blue-500/20";
    case "review":
      return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
    case "blocked":
      return "bg-red-500/10 text-red-700 border-red-500/20";
    default:
      return "bg-gray-500/10 text-gray-700 border-gray-500/20";
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

// Get team members for a specific task
// If task has a project, return only project members
// If task has no project, return all organization users
const getTeamMembersForTask = (task: Task, projects: any[], users: any[] = []) => {
  const memberMap = new Map<string, { id?: string; name: string; avatar: string; role: string }>();
  
  const taskProjectId = task?.projectId;
  const taskProjectName = task?.project;
  
  if (taskProjectId || taskProjectName) {
    // Task has a project - only show project members
    const taskProject = projects.find(p => 
      p.id === taskProjectId || 
      p.name === taskProjectId || 
      p.name === taskProjectName
    );
    
    if (taskProject?.members) {
      taskProject.members.forEach((member: any) => {
        if (!memberMap.has(member.name)) {
          memberMap.set(member.name, {
            id: member.id || member.email,
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
          id: user.email?.toLowerCase() || user.email,
          name: name,
          avatar: user.avatar || `${(user.firstName || '').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || user.email?.charAt(0).toUpperCase() || '?',
          role: user.jobTitle || 'Member',
        });
      }
    });
  }
  
  return Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export default function Tasks() {
  const navigate = useNavigate();
  const { toggleTask, isTaskSelected, selectedTasks } = useSelectedTasks();
  const { data: tasks = [], isLoading } = useUserTasks();
  const deleteTask = useDeleteTask();
  const updateTaskMutation = useUpdateTask();
  const { toast } = useToast();
  const { data: projects = [] } = useUserProjects();
  const { data: users = [] } = useUsers();
  const { isFreePlan } = useSubscription();
  const { user } = useAuth();
  const { parseDateString, formatDateForDisplay, handleDateSelection } = useDateSelection();
  const [filterStatus, setFilterStatus] = useState<Task["status"] | "all">("all");
  const [filterPriority, setFilterPriority] = useState<Task["priority"] | "all">("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [isNewTaskDialogOpen, setIsNewTaskDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null); // Stores task ID for progress popover (mobile only)
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, { status?: boolean; priority?: boolean; assignee?: boolean; dueDate?: boolean }>>({});
  const [taskToLimitVisibility, setTaskToLimitVisibility] = useState<{ id: string; task: Task } | null>(null);

  // Global user map for efficient lookups (scoped per organization)
  const userMap = useUserMap();

  // Memoized lookup functions
  const getAssigneeDisplayName = useCallback((assigneeId?: string, fallbackAssignee?: string): string | null => {
    if (fallbackAssignee) return fallbackAssignee;
    if (!assigneeId) return null;
    const user = userMap.get(assigneeId.toLowerCase());
    if (user) {
      return user.displayName || user.email;
    }
    return assigneeId;
  }, [userMap]);

  const getAssigneeInitials = useCallback((assigneeId?: string, fallbackAvatar?: string, fallbackAssignee?: string): string => {
    if (fallbackAvatar) return fallbackAvatar;
    if (!assigneeId) return "?";
    const user = userMap.get(assigneeId.toLowerCase());
    if (user) {
      return user.initials;
    }
    if (fallbackAssignee) {
      return fallbackAssignee.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return assigneeId.substring(0, 2).toUpperCase();
  }, [userMap]);

  const filteredTasks = tasks
    .filter((task) => {
      if (filterStatus !== "all" && task.status !== filterStatus) return false;
      if (filterPriority !== "all" && task.priority !== filterPriority) return false;
      if (filterProject !== "all") {
        // Match by project ID or project name
        const taskProjectId = task.projectId || '';
        const taskProjectName = task.project || '';
        if (filterProject === "none") {
          // Filter for tasks without a project
          if (taskProjectId || taskProjectName) return false;
        } else {
          // Filter for specific project
          if (taskProjectId !== filterProject && taskProjectName !== filterProject) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      // Sort by status first, then by creation time
      const statusOrder: Record<string, number> = {
        'todo': 1,
        'in-progress': 2,
        'review': 3,
        'blocked': 4,
        'completed': 5
      };
      
      const statusA = statusOrder[a.status || ''] || 6;
      const statusB = statusOrder[b.status || ''] || 6;
      
      if (statusA !== statusB) {
        return statusA - statusB;
      }
      
      // If status is the same, sort by creation time (newest first)
      // If createdAt is not available, fall back to createdDate parsing
      const timeA = a.createdAt || (a.createdDate ? new Date(a.createdDate).getTime() : 0);
      const timeB = b.createdAt || (b.createdDate ? new Date(b.createdDate).getTime() : 0);
      return timeB - timeA; // Descending order (newest first)
    });

  const handleTaskClick = (taskId: string) => {
    navigate(`/tasks/${taskId}`);
  };

  const handleProjectClick = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    navigate(`/projects/${projectId}`);
  };


  const handleDeleteClick = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    setTaskToDelete(taskId);
  };

  const handleDeleteConfirm = async () => {
    if (!taskToDelete) return;

    try {
      await deleteTask.mutateAsync(taskToDelete);
      toast({
        title: "Task deleted",
        description: "Task has been deleted successfully.",
      });
      setTaskToDelete(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  const handleFieldSave = async (taskId: string, field: keyof Task, value: any, additionalData?: Record<string, any>) => {
    try {
      // Get old value before update
      const task = tasks.find(t => t.id === taskId);
      const oldValue = task?.[field];
      
      await updateTaskMutation.mutateAsync({ 
        taskId, 
        updates: { [field]: value, ...additionalData } 
      });
      
      // Track task updates
      trackUpdate('task', taskId);
      
      // Track specific field changes
      if (field === 'status' && oldValue !== value) {
        trackEvent('task_status_changed', {
          task_id: taskId,
          old_status: oldValue as string,
          new_status: value as string,
        });
      } else if (field === 'priority' && oldValue !== value) {
        trackEvent('task_priority_changed', {
          task_id: taskId,
          old_priority: oldValue as string,
          new_priority: value as string,
        });
      } else if (field === 'assigneeId' && oldValue !== value) {
        trackEvent('task_assignee_changed', {
          task_id: taskId,
          old_assignee: oldValue as string || 'unassigned',
          new_assignee: value as string || 'unassigned',
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update task",
        variant: "destructive",
      });
    }
  };

  const setDropdownOpen = (taskId: string, field: 'status' | 'priority' | 'assignee' | 'dueDate', open: boolean) => {
    setOpenDropdowns(prev => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        [field]: open
      }
    }));
  };

  const isDropdownOpen = (taskId: string, field: 'status' | 'priority' | 'assignee' | 'dueDate') => {
    return openDropdowns[taskId]?.[field] || false;
  };


  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Tasks</h1>
        </div>
        <Button 
          className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
          onClick={() => setIsNewTaskDialogOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Status:</label>
          <Select value={filterStatus} onValueChange={(value) => {
            const newValue = value as Task["status"] | "all";
            setFilterStatus(newValue);
            trackFilter('status', newValue, '/tasks');
          }}>
            <SelectTrigger className="w-[93px] h-8 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent className="w-[93px] text-xs">
              <SelectItem value="all" className="text-xs py-1.5">All</SelectItem>
              <SelectItem value="todo" className="text-xs py-1.5">Todo</SelectItem>
              <SelectItem value="in-progress" className="text-xs py-1.5">In Progress</SelectItem>
              <SelectItem value="review" className="text-xs py-1.5">Review</SelectItem>
              <SelectItem value="blocked" className="text-xs py-1.5">Blocked</SelectItem>
              <SelectItem value="completed" className="text-xs py-1.5">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Priority:</label>
          <Select value={filterPriority} onValueChange={(value) => {
            const newValue = value as Task["priority"] | "all";
            setFilterPriority(newValue);
            trackFilter('priority', newValue, '/tasks');
          }}>
            <SelectTrigger className="w-[93px] h-8 text-xs">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent className="w-[93px] text-xs">
              <SelectItem value="all" className="text-xs py-1.5">All</SelectItem>
              <SelectItem value="low" className="text-xs py-1.5">Low</SelectItem>
              <SelectItem value="medium" className="text-xs py-1.5">Medium</SelectItem>
              <SelectItem value="high" className="text-xs py-1.5">High</SelectItem>
              <SelectItem value="urgent" className="text-xs py-1.5">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Project:</label>
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="all" className="text-xs py-1.5">All Projects</SelectItem>
              <SelectItem value="none" className="text-xs py-1.5">No Project</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id} className="text-xs py-1.5">
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {filteredTasks.map((task) => {
          // Get the latest progress update (sorted by date, newest first)
          const sortedUpdates = task.progressUpdates ? [...task.progressUpdates].sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateB - dateA;
          }) : [];
          const latestUpdate = sortedUpdates[0];
          const hasProgressUpdate = latestUpdate && latestUpdate.update;
          
          // Get assignee display name using memoized lookup
          const assigneeDisplayName = getAssigneeDisplayName(task.assigneeId, task.assignee);
          const assigneeInitials = getAssigneeInitials(task.assigneeId, task.assigneeAvatar, task.assignee);

          return (
            <div key={task.id} className="group">
              {/* Mobile: Single card, Desktop: Side-by-side cards */}
              <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
                {/* Main Task Card */}
                <Card 
                  className={cn(
                    "relative cursor-pointer group-hover:shadow-md transition-shadow overflow-hidden",
                    "flex-1 h-[120px] flex flex-col" // Fixed height and flex column
                  )}
                  onClick={() => handleTaskClick(task.id)}
                >
                {/* Mobile-only hover popover for progress update */}
                {hasProgressUpdate && (
                  <div className="absolute top-2 left-2 z-10 sm:hidden">
                    <Popover open={hoveredTask === task.id} onOpenChange={(open) => setHoveredTask(open ? task.id : null)}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                          onMouseEnter={() => setHoveredTask(task.id)}
                          onMouseLeave={() => setHoveredTask(null)}
                          title="Latest Progress Update"
                        >
                          <Sparkles className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent 
                        className="w-[calc(100vw-2rem)] max-w-sm max-h-[500px] overflow-y-auto" 
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={() => setHoveredTask(task.id)}
                        onMouseLeave={() => setHoveredTask(null)}
                        align="start"
                      >
                        <div className="space-y-4">
                          {/* Latest Progress Update */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-muted-foreground/70">LATEST PROGRESS UPDATE</p>
                              {latestUpdate.date && (
                                <p className="text-xs text-muted-foreground/60">
                                  {latestUpdate.date}
                                </p>
                              )}
                            </div>
                            <div className={cn("relative", isFreePlan && "blur-sm pointer-events-none")}>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                {latestUpdate.update}
                              </p>
                              {isFreePlan && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                                    Upgrade to view progress update
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Reason */}
                          {task.reason && (
                            <div className="space-y-2">
                              <div className="border-t border-border pt-2" />
                              <p className="text-xs font-medium text-muted-foreground/70">REASON</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                {task.reason}
                              </p>
                            </div>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                <CardHeader className="pb-3 flex-shrink-0 overflow-hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <CardTitle className="text-base line-clamp-1">{task.title}</CardTitle>
                      </div>
                      
                      {/* Task Meta Info */}
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground overflow-hidden">
                          <Popover 
                            open={isDropdownOpen(task.id, 'status')} 
                            onOpenChange={(open) => setDropdownOpen(task.id, 'status', open)}
                          >
                            <PopoverTrigger asChild>
                              <button 
                                type="button" 
                                className="inline-flex items-center border-0 bg-transparent p-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Badge 
                                  className={`${getStatusColor(task.status)} text-xs cursor-pointer`}
                                  variant="outline"
                                >
                                  {task.status.replace("-", " ")}
                                </Badge>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[200px] max-w-xs p-0" align="start" onClick={(e) => e.stopPropagation()}>
                              <Command>
                                <CommandList>
                                  <CommandGroup>
                                    {(["todo", "in-progress", "review", "blocked", "completed"] as const).map((status) => (
                                      <CommandItem
                                        key={status}
                                        value={status}
                                        onSelect={() => {
                                          handleFieldSave(task.id, 'status', status);
                                          setDropdownOpen(task.id, 'status', false);
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
                          <Popover 
                            open={isDropdownOpen(task.id, 'assignee')} 
                            onOpenChange={(open) => setDropdownOpen(task.id, 'assignee', open)}
                          >
                            <PopoverTrigger asChild>
                              <button 
                                type="button"
                                className={cn(
                                  "flex items-center gap-1 border-0 bg-transparent p-0 hover:opacity-80 transition-colors",
                                  task.assignee 
                                    ? "text-foreground font-medium" 
                                    : "text-muted-foreground"
                                )}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <User className="h-3.5 w-3.5" />
                                <span className="cursor-pointer">{assigneeDisplayName || "Unassigned"}</span>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[300px] max-w-sm p-0" align="start" onClick={(e) => e.stopPropagation()}>
                              <Command>
                                <CommandInput placeholder={(task.projectId || task.project) ? "Search project members..." : "Search organization members..."} />
                                <CommandList>
                                  <CommandEmpty>
                                    {(task.projectId || task.project) ? "No project member found." : "No organization member found."}
                                  </CommandEmpty>
                                  <CommandGroup>
                                    <CommandItem
                                      value="unassigned"
                                      onSelect={() => {
                                        handleFieldSave(task.id, 'assigneeId', undefined, {
                                          assigneeName: undefined,
                                          assignee: undefined,
                                          assigneeAvatar: undefined
                                        });
                                        setDropdownOpen(task.id, 'assignee', false);
                                      }}
                                    >
                                      <Check
                                        className={`mr-2 h-4 w-4 ${
                                          !assigneeDisplayName ? "opacity-100" : "opacity-0"
                                        }`}
                                      />
                                      Unassigned
                                    </CommandItem>
                                    {getTeamMembersForTask(task, projects, users).map((member) => (
                                      <CommandItem
                                        key={member.name}
                                        value={member.name}
                                        onSelect={() => {
                                          if (member.id) {
                                            handleFieldSave(task.id, 'assigneeId', member.id, {
                                              assigneeName: member.name,
                                              assignee: member.name, // Also keep assignee for frontend display
                                              assigneeAvatar: member.avatar
                                            });
                                            setDropdownOpen(task.id, 'assignee', false);
                                          }
                                        }}
                                      >
                                        <Check
                                          className={`mr-2 h-4 w-4 ${
                                            task.assigneeId?.toLowerCase() === member.id?.toLowerCase() ? "opacity-100" : "opacity-0"
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
                          <Popover 
                            open={isDropdownOpen(task.id, 'priority')} 
                            onOpenChange={(open) => setDropdownOpen(task.id, 'priority', open)}
                          >
                            <PopoverTrigger asChild>
                              <button 
                                type="button" 
                                className="inline-flex items-center border-0 bg-transparent p-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Badge 
                                  className={`${getPriorityColor(task.priority)} text-xs cursor-pointer`}
                                  variant="outline"
                                >
                                  {task.priority}
                                </Badge>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[200px] max-w-xs p-0" align="start" onClick={(e) => e.stopPropagation()}>
                              <Command>
                                <CommandList>
                                  <CommandGroup>
                                    {(["low", "medium", "high", "urgent"] as const).map((priority) => (
                                      <CommandItem
                                        key={priority}
                                        value={priority}
                                        onSelect={() => {
                                          handleFieldSave(task.id, 'priority', priority);
                                          setDropdownOpen(task.id, 'priority', false);
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
                          <Popover 
                            open={isDropdownOpen(task.id, 'dueDate')} 
                            onOpenChange={(open) => setDropdownOpen(task.id, 'dueDate', open)}
                          >
                            <PopoverTrigger asChild>
                              <button 
                                type="button"
                                className={cn(
                                  "flex items-center gap-1 border-0 bg-transparent p-0 hover:opacity-80 transition-colors",
                                  task.dueDate 
                                    ? "text-foreground font-medium" 
                                    : "text-muted-foreground"
                                )}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Calendar className="h-3.5 w-3.5" />
                                <span className="cursor-pointer">
                                  {formatDateForDisplay(task.dueDate)}
                                </span>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
                              <CalendarComponent
                                mode="single"
                                selected={parseDateString(task.dueDate)}
                                onSelect={(date) => {
                                  if (date) {
                                    handleDateSelection(date, (serverFormat) => {
                                      handleFieldSave(task.id, 'dueDate', serverFormat);
                                      setDropdownOpen(task.id, 'dueDate', false);
                                    });
                                  }
                                }}
                                initialFocus
                              />
                              {task.dueDate && (
                                <div className="p-3 border-t">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => {
                                      handleFieldSave(task.id, 'dueDate', null);
                                      setDropdownOpen(task.id, 'dueDate', false);
                                    }}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Remove due date
                                  </Button>
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                          {task.projectId && (
                            <button
                              onClick={(e) => handleProjectClick(e, task.projectId!)}
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <span>{task.project}</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                    </div>
                    <MoreOptionsMenu
                      items={[
                        {
                          icon: isTaskSelected(task.id) ? X : Plus,
                          label: isTaskSelected(task.id) ? "Remove from Context" : "Add to Context",
                          onClick: (e) => {
                            toggleTask(task);
                          },
                        },
                        {
                          icon: Edit,
                          label: "Edit",
                          onClick: () => {
                            navigate(`/tasks/${task.id}`);
                          },
                        },
                        {
                          icon: Share2,
                          label: "Limit Visibility",
                          onClick: () => {
                            setTaskToLimitVisibility({ id: task.id, task });
                          },
                          show: user && task.createdBy && user.email?.toLowerCase() === task.createdBy?.toLowerCase(),
                        },
                        {
                          icon: Trash2,
                          label: "Delete",
                          onClick: (e) => handleDeleteClick(e, task.id),
                          isDestructive: true,
                        },
                      ]}
                    />
                  </div>
                </CardHeader>
              </Card>

              {/* Latest Progress Update Card - Desktop only */}
              <div className="hidden sm:flex items-stretch gap-3 flex-1">
                {hasProgressUpdate ? (
                  <>
                    {/* Visual Connector Line */}
                    <div className="flex items-center justify-center w-4 flex-shrink-0">
                      <div className="w-0.5 h-full min-h-[100px] bg-border group-hover:bg-primary/50 transition-colors rounded-full" />
                    </div>
                    <Card 
                      className="flex-1 flex flex-col h-[120px] cursor-pointer group-hover:shadow-md transition-shadow overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <CardHeader className="pb-3 flex-shrink-0">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-muted-foreground/70">LATEST PROGRESS UPDATE</p>
                            {latestUpdate.date && (
                              <p className="text-xs text-muted-foreground/60">
                                {latestUpdate.date}
                              </p>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <div className="px-6 pb-6 flex-1 min-h-0">
                        <div className={cn("relative h-full max-h-[80px] overflow-y-auto", isFreePlan && "blur-sm pointer-events-none")}>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {latestUpdate.update}
                          </p>
                          {isFreePlan && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                                Upgrade to view progress update
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </>
                ) : (
                  <>
                    {/* Empty placeholder to maintain consistent container size */}
                    <div className="flex items-center justify-center w-4 flex-shrink-0">
                      <div className="w-0.5 h-full min-h-[100px] bg-transparent" />
                    </div>
                    <Card className="flex-1 h-[120px] opacity-0 pointer-events-none">
                      <CardHeader className="pb-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-muted-foreground/70">LATEST PROGRESS UPDATE</p>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  </>
                )}
              </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredTasks.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No tasks found matching your filters.</p>
        </div>
      )}

      <NewTaskDialog 
        open={isNewTaskDialogOpen} 
        onOpenChange={setIsNewTaskDialogOpen} 
      />

      {/* Limit Visibility Dialog */}
      {taskToLimitVisibility && (
        <LimitVisibilityDialog
          open={!!taskToLimitVisibility}
          onOpenChange={(open) => !open && setTaskToLimitVisibility(null)}
          title="Limit Task Visibility"
          itemName={taskToLimitVisibility.task.title}
          currentVisibility={taskToLimitVisibility.task.visibility || 'all_members'}
          currentVisibleToMembers={taskToLimitVisibility.task.visibleToMembers || []}
          onSave={async (newVisibility, newVisibleToMembers) => {
            await updateTaskMutation.mutateAsync({
              taskId: taskToLimitVisibility.id,
              updates: {
                visibility: newVisibility,
                visibleToMembers: newVisibleToMembers,
              },
            });
            toast({
              title: "Visibility updated",
              description: "Task visibility has been updated successfully.",
            });
            setTaskToLimitVisibility(null);
          }}
        />
      )}

      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
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

