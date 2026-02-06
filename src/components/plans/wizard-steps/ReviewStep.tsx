import { Calendar, DollarSign, User, FolderKanban, Target, Users, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useProjects } from '@/hooks/useProjects';
import type { Objective, ResourceAllocation } from '@/data/plansData';

interface ReviewStepProps {
  formData: any;
  objectives: Partial<Objective>[];
  selectedProjectIds: string[];
  resourceAllocations: ResourceAllocation[];
  onEditStep: (step: number) => void;
}

export function ReviewStep({
  formData,
  objectives,
  selectedProjectIds,
  resourceAllocations,
  onEditStep,
}: ReviewStepProps) {
  const { data: projects = [] } = useProjects();
  const selectedProjects = projects.filter((p) => selectedProjectIds.includes(p.id));
  
  const formatDate = (date: Date | undefined): string => {
    if (!date) return 'Not set';
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };
  
  const totalResourceBudget = resourceAllocations.reduce((total, alloc) => {
    const start = new Date(alloc.startDate);
    const end = new Date(alloc.endDate);
    const weeks = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7));
    const weeklyHours = (alloc.normalizedHours || 40) * (alloc.allocationPercentage / 100);
    const weeklyCost = weeklyHours * (alloc.hourlyRate || 75);
    return total + (weeklyCost * weeks);
  }, 0);
  
  // Check for over-allocations
  const userAllocations = new Map<string, number>();
  resourceAllocations.forEach(alloc => {
    const current = userAllocations.get(alloc.userId) || 0;
    userAllocations.set(alloc.userId, current + alloc.allocationPercentage);
  });
  
  const overallocatedUsers = Array.from(userAllocations.entries())
    .filter(([_, total]) => total > 100)
    .map(([userId, total]) => {
      const alloc = resourceAllocations.find(a => a.userId === userId);
      return { name: alloc?.userName || 'Unknown', total };
    });
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Review Your Plan</h3>
        <p className="text-sm text-muted-foreground">
          Please review all details before creating your plan
        </p>
      </div>
      
      {/* Warnings */}
      {overallocatedUsers.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
                  Over-allocation Warning
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  The following team members are allocated over 100%:
                </p>
                <ul className="mt-2 space-y-1">
                  {overallocatedUsers.map((user) => (
                    <li key={user.name} className="text-sm text-amber-800 dark:text-amber-200">
                      • {user.name} ({user.total}%)
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Plan Overview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Plan Overview</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEditStep(1)}
          >
            Edit
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-bold text-lg">{formData.name}</h4>
            {formData.description && (
              <p className="text-sm text-muted-foreground mt-1">{formData.description}</p>
            )}
          </div>
          
          <Separator />
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Timeline</p>
                <p className="text-sm font-medium">
                  {formatDate(formData.startDate)} - {formatDate(formData.endDate)}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Budget</p>
                <p className="text-sm font-medium">
                  {formData.currency} {formData.totalBudget?.toLocaleString() || 0}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Owner</p>
                <p className="text-sm font-medium truncate">{formData.ownerEmail}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Objectives */}
      {objectives.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Objectives</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEditStep(1)}
            >
              Edit
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {objectives.map((objective, index) => (
                <div key={index} className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-900">
                  <Target className="h-4 w-4 text-black dark:text-white mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{objective.text}</p>
                    <p className="text-xs text-muted-foreground">
                      Target: {objective.targetValue} {objective.unit}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Linked Projects */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Linked Projects</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEditStep(2)}
          >
            Edit
          </Button>
        </CardHeader>
        <CardContent>
          {selectedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects linked</p>
          ) : (
            <div className="space-y-2">
              {selectedProjects.map((project) => (
                <div key={project.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-900">
                  <FolderKanban className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium flex-1 truncate">{project.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {project.status}
                  </Badge>
                </div>
              ))}
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Total: {selectedProjects.length} project{selectedProjects.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Resource Allocation Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Resource Allocation</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEditStep(3)}
          >
            Edit
          </Button>
        </CardHeader>
        <CardContent>
          {resourceAllocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resources allocated</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Team Size</p>
                  <p className="text-lg font-bold text-black dark:text-white">
                    {resourceAllocations.length}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Avg Allocation</p>
                  <p className="text-lg font-bold text-black dark:text-white">
                    {Math.round(
                      resourceAllocations.reduce((sum, a) => sum + a.allocationPercentage, 0) /
                        resourceAllocations.length
                    )}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Est. Cost</p>
                  <p className="text-lg font-bold text-black dark:text-white">
                    ${Math.round(totalResourceBudget).toLocaleString()}
                  </p>
                </div>
              </div>
              
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {resourceAllocations.map((alloc) => (
                  <div
                    key={alloc.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-900"
                  >
                    <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{alloc.userName}</p>
                      <p className="text-xs text-muted-foreground">{alloc.role}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {alloc.allocationPercentage}%
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
