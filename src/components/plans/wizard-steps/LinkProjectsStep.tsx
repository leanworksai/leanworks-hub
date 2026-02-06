import { useState } from 'react';
import { Search, X, FolderKanban, Users, DollarSign, Check, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProjects } from '@/hooks/useProjects';
import { cn } from '@/lib/utils';
import type { Project } from '@/data/projectsData';

interface LinkProjectsStepProps {
  selectedProjectIds: string[];
  setSelectedProjectIds: (ids: string[]) => void;
}

export function LinkProjectsStep({ selectedProjectIds, setSelectedProjectIds }: LinkProjectsStepProps) {
  const { data: projects = [] } = useProjects();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  
  // Filter projects
  const filteredProjects = projects.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (p.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = showSelectedOnly ? selectedProjectIds.includes(p.id) : true;
    return matchesSearch && matchesFilter;
  });
  
  const selectedProjects = projects.filter((p) => selectedProjectIds.includes(p.id));
  
  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((prev) => (
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    ));
  };
  
  const estimatedTeamSize = selectedProjects.reduce((total, p) => total + (p.teamSize || 0), 0);
  const estimatedBudget = selectedProjects.reduce((total, p) => total + (p.budgetAllocated || 0), 0);
  
  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[600px]">
      {/* Main Content: Project List */}
      <div className="flex-1 flex flex-col min-h-0 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white dark:bg-slate-950"
            />
          </div>
          <Button
            variant={showSelectedOnly ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowSelectedOnly(!showSelectedOnly)}
            className="shrink-0"
          >
            <Filter className="h-4 w-4 mr-2" />
            {showSelectedOnly ? "Show All" : "Selected Only"}
            {selectedProjectIds.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 min-w-[20px]">
                {selectedProjectIds.length}
              </Badge>
            )}
          </Button>
        </div>

        <ScrollArea className="flex-1 pr-4 -mr-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
            {filteredProjects.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg bg-slate-50/50 dark:bg-slate-900/50">
                <FolderKanban className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">
                  {searchQuery ? 'No projects match your search' : 'No projects available'}
                </p>
                {showSelectedOnly && (
                  <Button variant="link" onClick={() => setShowSelectedOnly(false)} className="mt-2">
                    Show all projects
                  </Button>
                )}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const isSelected = selectedProjectIds.includes(project.id);
                
                return (
                  <div
                    key={project.id}
                    className={cn(
                      "group relative flex flex-col p-4 rounded-xl border transition-all duration-200 cursor-pointer hover:shadow-md",
                      isSelected 
                        ? "border-black dark:border-white bg-slate-50 dark:bg-slate-900 shadow-sm" 
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700"
                    )}
                    onClick={() => toggleProject(project.id)}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "p-2 rounded-lg transition-colors",
                          isSelected ? "bg-black dark:bg-white text-white dark:text-black" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                        )}>
                          <FolderKanban className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className={cn("font-semibold text-sm truncate", isSelected && "text-black dark:text-white")}>
                            {project.name}
                          </h4>
                          <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                            {project.status}
                          </p>
                        </div>
                      </div>
                      <div className={cn(
                        "h-5 w-5 rounded-full border flex items-center justify-center transition-all",
                        isSelected 
                          ? "bg-black dark:bg-white border-black dark:border-white text-white dark:text-black" 
                          : "border-slate-300 dark:border-slate-600 group-hover:border-slate-400"
                      )}>
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 mb-4 flex-1">
                      {project.description || "No description provided"}
                    </p>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground pt-3 border-t border-slate-100 dark:border-slate-800/50">
                      {project.teamSize && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {project.teamSize}
                        </span>
                      )}
                      {project.budgetAllocated && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          ${project.budgetAllocated.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Sidebar: Summary */}
      <div className="w-full lg:w-80 shrink-0 space-y-4">
        <Card className="h-full border-l-4 border-l-black dark:border-l-white shadow-sm bg-slate-50/50 dark:bg-slate-900/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-black dark:bg-white flex items-center justify-center text-white dark:text-black text-xs">
                {selectedProjectIds.length}
              </div>
              Selected Projects
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Metrics */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-white dark:bg-slate-950 border shadow-sm">
                <p className="text-xs text-muted-foreground mb-1">Total Budget</p>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  ${estimatedBudget.toLocaleString()}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white dark:bg-slate-950 border shadow-sm">
                <p className="text-xs text-muted-foreground mb-1">Team Size</p>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {estimatedTeamSize}
                </p>
              </div>
            </div>

            {/* Selected List Preview */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Recently Added
              </p>
              <ScrollArea className="h-[280px] pr-3">
                {selectedProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4 text-center">
                    No projects selected
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedProjects.map(project => (
                      <div key={project.id} className="group flex items-center justify-between p-2 rounded-md bg-white dark:bg-slate-950 border text-sm">
                        <span className="truncate flex-1 font-medium">{project.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleProject(project.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
