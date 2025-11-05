import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Users, Calendar, CheckCircle2, Circle, Clock, ChevronDown, Send, Activity, MessageSquare } from "lucide-react";
import { projects } from "@/data/projectsData";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";

export default function ProjectDetail() {
  const { projectName } = useParams();
  const navigate = useNavigate();
  const [commentInput, setCommentInput] = useState("");
  
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
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
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
                              <span className="text-xs text-muted-foreground">{activity.date}</span>
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
    </div>
  );
}
