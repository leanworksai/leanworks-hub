import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Calendar, User, Target, TrendingUp, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { usePlanById } from '@/hooks/usePlans';
import { useUserProjects } from '@/hooks/useProjects';
import { HealthScoreWidget } from '@/components/plans/HealthScoreWidget';
import { BudgetChart } from '@/components/plans/BudgetChart';
import { ResourceAllocationTimeline } from '@/components/plans/ResourceAllocationTimeline';
import { AIInsightsCard } from '@/components/plans/AIInsightsCard';
import { calculateHealthScore, calculateBurnRate } from '@/utils/planCalculations';
import { cn } from '@/lib/utils';
import type { Objective } from '@/types/plans';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { AgentTriggerButton } from '@/components/ai-agents/AgentTriggerButton';

export default function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: plan, isLoading } = usePlanById(id!);
  const { data: allProjects = [] } = useUserProjects();
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  // AI insights come from backend DB (plan.aiInsights), not live API
  const insights = plan?.aiInsights ?? null;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Loading plan...</p>
      </div>
    );
  }
  
  if (!plan) {
    return (
      <div className="h-full flex flex-col items-center justify-center space-y-4">
        <p className="text-lg font-semibold">Plan not found</p>
        <Button onClick={() => navigate('/plans')}>Back to Plans</Button>
      </div>
    );
  }
  
  const healthBreakdown = calculateHealthScore(plan);
  const burnRate = calculateBurnRate(plan.spentToDate, plan.startDate, plan.endDate, plan.totalBudget);
  
  // Filter projects that belong to this plan
  const planProjects = allProjects.filter(p => (plan.projectIds ?? []).includes(p.id));
  
  const getStatusBadgeVariant = (status: typeof plan.status) => {
    switch (status) {
      case 'planning':
        return 'secondary';
      case 'active':
        return 'default';
      case 'at-risk':
        return 'destructive';
      case 'completed':
        return 'outline';
      default:
        return 'default';
    }
  };
  
  const getObjectiveStatusIcon = (status: Objective['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'at-risk':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Circle className="h-4 w-4 text-blue-600" />;
    }
  };
  
  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(dateString));
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: plan.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };
  
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/plans')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold">{plan.name}</h1>
                <Badge variant={getStatusBadgeVariant(plan.status) as any}>
                  {plan.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{plan.description}</p>
            </div>
            
            <HealthScoreWidget
              score={plan.healthScore}
              trend={plan.healthTrend}
              breakdown={healthBreakdown}
              size="lg"
              showTrend={true}
            />
            
            <AgentTriggerButton entityType="plan" entityId={plan.id} />

            <Button variant="outline" size="sm">
              <Edit className="h-4 w-4 mr-2" />
              Edit Plan
            </Button>
          </div>
          
          {/* Meta info */}
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              <span>{formatDate(plan.startDate)} - {formatDate(plan.endDate)}</span>
            </div>
            <div className="flex items-center gap-1">
              <User className="h-4 w-4" />
              <span>{plan.ownerName}</span>
            </div>
            <div className="flex items-center gap-1">
              <Target className="h-4 w-4" />
              <span>{(plan.projectIds ?? []).length} projects</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* AI Insights (from backend DB) - only show when present */}
          {insights ? (
            <AIInsightsCard
              insights={insights}
              onAskAI={() => {
                // Would open AI chat with plan context
                console.log('Open AI chat with plan context');
              }}
            />
          ) : null}
          
          {/* Objectives & Key Results */}
          <Card>
            <CardHeader>
              <CardTitle>Objectives & Key Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {plan.objectives.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No objectives defined yet
                </p>
              ) : (
                plan.objectives.map((objective) => {
                  const progress = (objective.currentValue / objective.targetValue) * 100;
                  return (
                    <div key={objective.id} className="space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-2 flex-1">
                          {getObjectiveStatusIcon(objective.status)}
                          <div className="flex-1">
                            <p className="font-medium text-sm">{objective.text}</p>
                            {objective.dueDate && (
                              <p className="text-xs text-muted-foreground">
                                Due: {formatDate(objective.dueDate)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">
                            {objective.currentValue.toLocaleString()} / {objective.targetValue.toLocaleString()}
                            {objective.unit === 'percentage' && '%'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {progress.toFixed(0)}% complete
                          </p>
                        </div>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
          
          {/* Budget & Resources Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Budget Dashboard */}
            <BudgetChart
              categories={plan.budgetCategories}
              totalBudget={plan.totalBudget}
              spentToDate={plan.spentToDate}
              currency={plan.currency}
            />
            
            {/* Budget Burn Rate Card */}
            <Card>
              <CardHeader>
                <CardTitle>Burn Rate Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Daily Burn Rate</span>
                    <span className="font-semibold">{formatCurrency(burnRate.dailyRate)}/day</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Days Remaining</span>
                    <span className="font-semibold">{burnRate.daysRemaining} days</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Projected Total</span>
                    <span className={cn(
                      'font-semibold',
                      burnRate.onTrack ? 'text-green-600' : 'text-red-600'
                    )}>
                      {formatCurrency(burnRate.projectedTotal)}
                    </span>
                  </div>
                </div>
                
                <div className={cn(
                  'p-3 rounded-md border',
                  burnRate.onTrack
                    ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
                    : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
                )}>
                  <p className={cn(
                    'text-sm font-medium',
                    burnRate.onTrack ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'
                  )}>
                    {burnRate.onTrack ? (
                      <>Budget is on track to stay within limits</>
                    ) : (
                      <>
                        Budget projected to exceed by {formatCurrency(burnRate.projectedTotal - plan.totalBudget)}
                      </>
                    )}
                  </p>
                </div>
                
                {/* Milestones */}
                <div className="pt-4 border-t space-y-3">
                  <p className="text-sm font-semibold">Milestones</p>
                  {plan.milestones.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No milestones defined</p>
                  ) : (
                    <div className="space-y-2">
                      {plan.milestones.map((milestone) => (
                        <div key={milestone.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {milestone.status === 'completed' ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : milestone.status === 'at-risk' ? (
                              <AlertCircle className="h-4 w-4 text-red-600" />
                            ) : (
                              <Circle className="h-4 w-4 text-blue-600" />
                            )}
                            <span>{milestone.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(milestone.dueDate)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Resource Allocation */}
          <ResourceAllocationTimeline
            allocations={plan.resourceAllocations ?? []}
            startDate={plan.startDate}
            endDate={plan.endDate}
          />
          
          {/* Linked Projects */}
          <Card>
            <CardHeader>
              <CardTitle>Linked Projects ({(plan.projectIds ?? []).length})</CardTitle>
            </CardHeader>
            <CardContent>
              {planProjects.length === 0 ? (
                <div className="text-center py-8">
                  <Target className="h-12 w-12 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No projects linked yet</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => navigate('/projects')}
                  >
                    Add Projects
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {planProjects.map((project) => (
                    <Card
                      key={project.id}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <CardHeader className="pb-3">
                        <div className="space-y-2">
                          <CardTitle className="text-base">{project.name}</CardTitle>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {project.description}
                          </p>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {project.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {project.memberCount} members
                            </span>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Activity Feed */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {plan.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No recent activity
                </p>
              ) : (
                <div className="space-y-4">
                  {plan.recentActivity.map((activity) => {
                    const activityDate = new Date(activity.timestamp);
                    const isRecent = Date.now() - activityDate.getTime() < 24 * 60 * 60 * 1000;
                    
                    return (
                      <div key={activity.id} className="flex gap-4 pb-4 border-b last:border-0">
                        <div className={cn(
                          'w-2 h-2 rounded-full mt-2',
                          activity.type === 'milestone' ? 'bg-purple-500' :
                          activity.type === 'risk' ? 'bg-red-500' :
                          activity.type === 'project_update' ? 'bg-blue-500' :
                          activity.type === 'budget_change' ? 'bg-yellow-500' :
                          'bg-gray-500'
                        )} />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">{activity.title}</p>
                            {isRecent && (
                              <Badge variant="secondary" className="text-xs">New</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{activity.description}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {activity.userName && <span>{activity.userName}</span>}
                            <span>•</span>
                            <span>{formatDate(activity.timestamp)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
