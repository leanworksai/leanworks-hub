import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, MoreVertical, Users, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { projects } from "@/data/projectsData";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectionMode } from "@/contexts/SelectionModeContext";

const truncateText = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

export default function Projects() {
  const navigate = useNavigate();
  const { toggleProject, isProjectSelected, selectedProjects } = useSelectedProjects();
  const { isSelectionMode } = useSelectionMode();

  const handleCardClick = (projectName: string) => {
    // Don't navigate if in selection mode
    if (isSelectionMode) return;
    const slug = projectName.toLowerCase().replace(/\s+/g, '-');
    navigate(`/projects/${slug}`);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage and track your active projects
            {selectedProjects.length > 0 && (
              <span className="ml-2 text-primary">
                ({selectedProjects.length} selected)
              </span>
            )}
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((project) => (
          <Card 
            key={project.name} 
            className={`bg-gradient-card border-border shadow-card cursor-pointer hover:shadow-lg transition-shadow ${
              isProjectSelected(project.name) ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => handleCardClick(project.name)}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1 mr-2">
                  <div className="flex items-center gap-3">
                    {isSelectionMode && (
                      <Checkbox
                        checked={isProjectSelected(project.name)}
                        onCheckedChange={() => toggleProject(project)}
                        onClick={handleCheckboxClick}
                        className="mt-1"
                      />
                    )}
                    <CardTitle className="text-xl">{project.name}</CardTitle>
                  </div>
                  <CardDescription className={`line-clamp-2 ${isSelectionMode ? 'ml-7' : ''}`}>{project.description}</CardDescription>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle menu action
                  }}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`pt-2 border-t border-border ${isSelectionMode ? 'ml-7' : ''}`}>
                <p className="text-xs font-medium text-muted-foreground/70 mb-3">PROGRESS SUMMARY</p>
                <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                  <li>{truncateText(project.summary.accomplishment, 80)}</li>
                  <li>{truncateText(project.summary.decision, 80)}</li>
                  <li>{truncateText(project.summary.risk, 80)}</li>
                  <li>{truncateText(project.summary.direction, 80)}</li>
                </ul>
              </div>
              <div className={`flex items-center justify-between text-sm pt-2 border-t border-border ${isSelectionMode ? 'ml-7' : ''}`}>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>{project.team} members</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>{project.dueDate}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
