import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
  Plus, 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle, 
  FileCheck,
  Calendar,
  User,
  ArrowRight,
  MoreVertical,
  Trash2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Task } from "@/data/tasksData";
import { useState } from "react";
import { useUserTasks, useDeleteTask } from "@/hooks/useTasks";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectionMode } from "@/contexts/SelectionModeContext";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { useToast } from "@/hooks/use-toast";

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

export default function Tasks() {
  const navigate = useNavigate();
  const { toggleTask, isTaskSelected, selectedTasks } = useSelectedTasks();
  const { isSelectionMode } = useSelectionMode();
  const { data: tasks = [], isLoading } = useUserTasks();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<Task["status"] | "all">("all");
  const [filterPriority, setFilterPriority] = useState<Task["priority"] | "all">("all");
  const [isNewTaskDialogOpen, setIsNewTaskDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  const filteredTasks = tasks
    .filter((task) => {
      if (filterStatus !== "all" && task.status !== filterStatus) return false;
      if (filterPriority !== "all" && task.priority !== filterPriority) return false;
      return true;
    })
    .sort((a, b) => {
      // Sort by creation time (newest first)
      // If createdAt is not available, fall back to createdDate parsing
      const timeA = a.createdAt || (a.createdDate ? new Date(a.createdDate).getTime() : 0);
      const timeB = b.createdAt || (b.createdDate ? new Date(b.createdDate).getTime() : 0);
      return timeB - timeA; // Descending order (newest first)
    });

  const handleTaskClick = (taskId: string) => {
    // Don't navigate if in selection mode
    if (isSelectionMode) return;
    navigate(`/tasks/${taskId}`);
  };

  const handleProjectClick = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    navigate(`/projects/${projectId}`);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          {selectedTasks.length > 0 && (
            <p className="text-muted-foreground">
              <span className="text-primary">
                ({selectedTasks.length} selected)
              </span>
            </p>
          )}
        </div>
        <Button 
          className="bg-primary hover:bg-primary/90"
          onClick={() => setIsNewTaskDialogOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Button
            variant={filterStatus === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("all")}
          >
            All
          </Button>
          {(["todo", "in-progress", "review", "blocked", "completed"] as const).map((status) => (
            <Button
              key={status}
              variant={filterStatus === status ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus(status)}
            >
              {status.replace("-", " ")}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-4">
          <span className="text-sm text-muted-foreground">Priority:</span>
          <Button
            variant={filterPriority === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterPriority("all")}
          >
            All
          </Button>
          {(["low", "medium", "high", "urgent"] as const).map((priority) => (
            <Button
              key={priority}
              variant={filterPriority === priority ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterPriority(priority)}
            >
              {priority}
            </Button>
          ))}
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {filteredTasks.map((task) => (
          <Card 
            key={task.id} 
            className={`bg-gradient-card border-border shadow-card hover:shadow-lg transition-all cursor-pointer ${
              isTaskSelected(task.id) ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => handleTaskClick(task.id)}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {isSelectionMode && (
                    <Checkbox
                      checked={isTaskSelected(task.id)}
                      onCheckedChange={() => toggleTask(task)}
                      onClick={handleCheckboxClick}
                      className="mt-1 flex-shrink-0"
                    />
                  )}
                  <div className="mt-1 flex-shrink-0">
                    {getStatusIcon(task.status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <CardTitle className="text-lg">{task.title}</CardTitle>
                      <Badge 
                        className={`${getPriorityColor(task.priority)} text-xs`}
                        variant="outline"
                      >
                        {task.priority}
                      </Badge>
                      <Badge 
                        className={`${getStatusColor(task.status)} text-xs`}
                        variant="outline"
                      >
                        {task.status.replace("-", " ")}
                      </Badge>
                    </div>
                    
                    {/* Task Meta Info */}
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>{task.assignee}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        <span>{task.dueDate}</span>
                      </div>
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
                      onClick={(e) => handleDeleteClick(e, task.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
          </Card>
        ))}
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

