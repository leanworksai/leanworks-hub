import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Plus, 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle, 
  FileCheck,
  ArrowRight,
  Calendar,
  User,
  Tag,
  TrendingUp,
  MessageSquare,
  AlertTriangle,
  Flag,
  CheckCircle
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { tasks, Task } from "@/data/tasksData";
import { useState } from "react";

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

export default function Tasks() {
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState<Task["status"] | "all">("all");
  const [filterPriority, setFilterPriority] = useState<Task["priority"] | "all">("all");

  const filteredTasks = tasks.filter((task) => {
    if (filterStatus !== "all" && task.status !== filterStatus) return false;
    if (filterPriority !== "all" && task.priority !== filterPriority) return false;
    return true;
  });

  const handleProjectClick = (projectId: string) => {
    const slug = projectId.toLowerCase().replace(/\s+/g, '-');
    navigate(`/projects/${slug}`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground">
            Track tasks with progress updates and timeline
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
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
      <div className="space-y-4">
        {filteredTasks.map((task) => (
          <Card 
            key={task.id} 
            className="bg-gradient-card border-border shadow-card hover:shadow-lg transition-shadow"
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-1">
                    {getStatusIcon(task.status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
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
                    <CardDescription className="mb-3">
                      {task.description}
                    </CardDescription>
                    
                    {/* Task Meta Info */}
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-3">
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>{task.assignee}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        <span>Due: {task.dueDate}</span>
                      </div>
                      {task.estimatedHours && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>
                            {task.actualHours || 0}h / {task.estimatedHours}h
                          </span>
                        </div>
                      )}
                      <button
                        onClick={() => handleProjectClick(task.projectId)}
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <span>{task.project}</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Tags */}
                    {task.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {task.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            <Tag className="h-3 w-3 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            
            <CardContent>
              {/* Progress Updates Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    PROGRESS UPDATES ({task.progressUpdates.length})
                  </h3>
                </div>
                
                {task.progressUpdates.length > 0 ? (
                  <div className="space-y-3 max-h-[280px] overflow-y-auto pr-2">
                    {task.progressUpdates.map((update) => (
                      <div 
                        key={update.id} 
                        className="border-l-2 border-primary/30 pl-4 pb-4 last:pb-0 relative"
                      >
                        <div className="absolute -left-2 top-0 h-4 w-4 rounded-full bg-background border-2 border-primary/50" />
                        <div className="flex items-start gap-3 mb-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {update.memberAvatar}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-sm">{update.memberName}</p>
                              <span className="text-xs text-muted-foreground">{update.date}</span>
                              {update.type && (
                                <Badge 
                                  className={`${getUpdateTypeColor(update.type)} text-xs flex items-center gap-1`}
                                  variant="outline"
                                >
                                  {getUpdateTypeIcon(update.type)}
                                  <span>{update.type}</span>
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {update.update}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No progress updates yet
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredTasks.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No tasks found matching your filters.</p>
        </div>
      )}
    </div>
  );
}

