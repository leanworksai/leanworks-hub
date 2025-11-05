import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Users, Calendar, CheckCircle2, Circle, Clock } from "lucide-react";
import { projects } from "@/data/projectsData";

export default function ProjectDetail() {
  const { projectName } = useParams();
  const navigate = useNavigate();
  
  const project = projects.find(
    (p) => p.name.toLowerCase().replace(/\s+/g, '-') === projectName
  );

  if (!project) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold">Project not found</h1>
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

  return (
    <div className="space-y-6 animate-fade-in">
      <Button variant="ghost" onClick={() => navigate("/projects")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Projects
      </Button>

      <div>
        <div className="flex items-start justify-between mb-2">
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <Badge className={`${project.statusColor} text-white`}>
            {project.status}
          </Badge>
        </div>
        <p className="text-muted-foreground text-lg mb-4">{project.description}</p>
        <p className="text-foreground mb-4">{project.detailedDescription}</p>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>Created: <span className="text-foreground font-medium">{project.createdDate}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>Due: <span className="text-foreground font-medium">{project.dueDate}</span></span>
          </div>
        </div>
      </div>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Team Members</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>{project.team} members</span>
            </div>
          </div>
        </CardHeader>
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
      </Card>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Tasks</CardTitle>
              <span className="text-sm text-muted-foreground">
                {project.tasks.filter(t => t.status === "completed").length} / {project.tasks.length} completed
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${(project.tasks.filter(t => t.status === "completed").length / project.tasks.length) * 100}%` }}
              />
            </div>
          </div>
        </CardHeader>
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
                    <span>Due: {task.dueDate}</span>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs capitalize">
                  {task.status.replace("-", " ")}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="text-xl">Progress Updates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {project.progressUpdates.map((update) => (
              <div key={update.id} className="border-l-2 border-primary pl-4 pb-4 last:pb-0">
                <div className="flex items-start gap-3 mb-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {update.memberAvatar}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{update.memberName}</p>
                      <span className="text-xs text-muted-foreground">{update.date}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{update.update}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
