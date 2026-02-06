import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, TrendingUp, TrendingDown, Minus, Users, Calendar, DollarSign, Target, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFilteredPlans } from '@/hooks/usePlans';
import { HealthScoreWidget } from '@/components/plans/HealthScoreWidget';
import { NewPlanDialog } from '@/components/NewPlanDialog';
import { generateQuickInsight } from '@/utils/aiInsightsGenerator';
import { cn } from '@/lib/utils';
import type { Plan } from '@/data/plansData';

export default function Plans() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Plan['status'] | 'all'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'health' | 'budget' | 'timeline'>('name');
  const [showNewPlanDialog, setShowNewPlanDialog] = useState(false);
  
  const { plans, isLoading } = useFilteredPlans(searchQuery, statusFilter, sortBy);
  
  const getStatusBadgeVariant = (status: Plan['status']) => {
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
  
  const getStatusColor = (status: Plan['status']) => {
    switch (status) {
      case 'planning':
        return 'bg-gray-500';
      case 'active':
        return 'bg-blue-500';
      case 'at-risk':
        return 'bg-orange-500';
      case 'completed':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };
  
  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  };
  
  const calculateBudgetUtilization = (spent: number, total: number) => {
    return total > 0 ? (spent / total) * 100 : 0;
  };
  
  const calculateProjectsOnTrack = (plan: Plan) => {
    // For now, mock calculation - would integrate with actual project data
    return Math.floor(plan.projectIds.length * 0.7);
  };
  
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-6 gap-4">
          <div className="flex items-center gap-2 flex-1">
            <Target className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Plans</h1>
            <Badge variant="secondary" className="ml-2">
              {plans.length}
            </Badge>
          </div>
          
          {/* Search */}
          <div className="relative w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search plans..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          
          {/* Filters */}
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="planning">Planning</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="at-risk">At Risk</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="health">Health Score</SelectItem>
              <SelectItem value="budget">Budget</SelectItem>
              <SelectItem value="timeline">Timeline</SelectItem>
            </SelectContent>
          </Select>
          
          {/* New Plan Button */}
          <Button onClick={() => setShowNewPlanDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Plan
          </Button>
        </div>
      </div>
      
      {/* Plans List */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading plans...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-4">
            <Target className="h-16 w-16 text-muted-foreground/50" />
            <div className="text-center space-y-2">
              <p className="text-lg font-semibold">No plans found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery || statusFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Get started by creating your first plan'}
              </p>
            </div>
            {!searchQuery && statusFilter === 'all' && (
              <Button onClick={() => setShowNewPlanDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Plan
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => {
              const budgetUtilization = calculateBudgetUtilization(plan.spentToDate, plan.totalBudget);
              const onTrackProjects = calculateProjectsOnTrack(plan);
              const quickInsight = generateQuickInsight(plan);
              
              return (
                <Card
                  key={plan.id}
                  className="cursor-pointer hover:shadow-md transition-shadow group border-slate-200 dark:border-slate-800"
                  onClick={() => navigate(`/plans/${plan.id}`)}
                >
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Plan info */}
                      <div className="flex-1 space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors">{plan.name}</h3>
                              <Badge variant={getStatusBadgeVariant(plan.status) as any}>
                                {plan.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {plan.description}
                            </p>
                          </div>
                        </div>
                        
                        {/* Metrics row */}
                        <div className="grid grid-cols-4 gap-6">
                          {/* Budget */}
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              <DollarSign className="h-3.5 w-3.5" />
                              <span>Budget</span>
                            </div>
                            <div className="space-y-1.5">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-sm font-semibold tabular-nums">{formatCurrency(plan.spentToDate)}</span>
                                <span className="text-xs text-muted-foreground">/ {formatCurrency(plan.totalBudget)}</span>
                              </div>
                              <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    'h-full transition-all duration-500',
                                    budgetUtilization < 75 ? 'bg-emerald-500' :
                                    budgetUtilization < 90 ? 'bg-amber-500' :
                                    'bg-red-500'
                                  )}
                                  style={{ width: `${Math.min(budgetUtilization, 100)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                          
                          {/* Timeline */}
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              <Calendar className="h-3.5 w-3.5" />
                              <span>Timeline</span>
                            </div>
                            <p className="text-sm font-medium tabular-nums text-slate-700 dark:text-slate-300">
                              {formatDateRange(plan.startDate, plan.endDate)}
                            </p>
                          </div>
                          
                          {/* Projects */}
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              <Target className="h-3.5 w-3.5" />
                              <span>Projects</span>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-300">{onTrackProjects}</span>
                              <span className="text-xs text-muted-foreground">/ {plan.projectIds.length} on track</span>
                            </div>
                          </div>
                          
                          {/* Team */}
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              <Users className="h-3.5 w-3.5" />
                              <span>Team</span>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-300">{plan.teamSize}</span>
                              <span className="text-xs text-muted-foreground">members</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* AI Insight preview */}
                        <div className="relative group/insight">
                          <div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-indigo-500/10 rounded-lg opacity-50 group-hover/insight:opacity-100 transition-opacity" />
                          <div className="relative flex items-start gap-3 p-3 rounded-lg border border-violet-100 dark:border-violet-900/30 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                            <div className="mt-0.5 p-1 bg-violet-100 dark:bg-violet-900/50 rounded-md shrink-0">
                              <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">AI Summary</span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                                {quickInsight}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Right: Health score */}
                      <div className="flex-shrink-0 pl-4 border-l border-slate-100 dark:border-slate-800">
                        <HealthScoreWidget
                          score={plan.healthScore}
                          trend={plan.healthTrend}
                          size="md"
                          showTrend={true}
                        />
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      
      {/* New Plan Dialog */}
      <NewPlanDialog open={showNewPlanDialog} onOpenChange={setShowNewPlanDialog} />
    </div>
  );
}
