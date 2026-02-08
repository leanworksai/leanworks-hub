import { useState } from 'react';
import { 
  DollarSign, 
  Clock, 
  Users, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Edit2
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ResourceAllocationEditor } from './ResourceAllocationEditor';
import type { AIResourcePlan } from '@/utils/aiResourcePlanner';
import type { ResourceAllocation } from '@/types/plans';

interface ResourcePlanCardProps {
  plan: AIResourcePlan;
  isSelected: boolean;
  onSelect: () => void;
}

export function ResourcePlanCard({ plan, isSelected, onSelect }: ResourcePlanCardProps) {
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedAllocations, setEditedAllocations] = useState<ResourceAllocation[]>(plan.allocations);
  const durationValue = Number.isFinite(plan.estimatedDurationDays)
    ? Math.ceil(plan.estimatedDurationDays)
    : 0;
  
  // Color scheme based on strategy
  const colorScheme = {
    cost: {
      primary: 'slate-900 dark:slate-100',
      bg: 'slate-50 dark:slate-900',
      border: 'slate-200 dark:slate-800',
      text: 'slate-900 dark:slate-100',
      icon: 'slate-900 dark:slate-100',
    },
    time: {
      primary: 'slate-900 dark:slate-100',
      bg: 'slate-50 dark:slate-900',
      border: 'slate-200 dark:slate-800',
      text: 'slate-900 dark:slate-100',
      icon: 'slate-900 dark:slate-100',
    },
    quality: {
      primary: 'slate-900 dark:slate-100',
      bg: 'slate-50 dark:slate-900',
      border: 'slate-200 dark:slate-800',
      text: 'slate-900 dark:slate-100',
      icon: 'slate-900 dark:slate-100',
    },
  }[plan.strategy];
  
  const riskIcon = {
    low: <TrendingDown className="h-4 w-4 text-green-500" />,
    medium: <Minus className="h-4 w-4 text-amber-500" />,
    high: <AlertTriangle className="h-4 w-4 text-red-500" />,
  }[plan.riskLevel];
  
  const handleEditAllocations = () => {
    setIsEditMode(!isEditMode);
    if (!isEditMode) {
      setEditedAllocations([...plan.allocations]);
    }
  };
  
  const handleUpdateAllocation = (allocationId: string, updates: Partial<ResourceAllocation>) => {
    setEditedAllocations(prev =>
      prev.map(alloc => alloc.id === allocationId ? { ...alloc, ...updates } : alloc)
    );
  };
  
  const handleRemoveAllocation = (allocationId: string) => {
    setEditedAllocations(prev => prev.filter(alloc => alloc.id !== allocationId));
  };
  
  const handleResetToAI = () => {
    setEditedAllocations([...plan.allocations]);
  };
  
  const displayAllocations = isEditMode ? editedAllocations : plan.allocations;
  
  return (
    <Card
      className={cn(
        'transition-all duration-300 cursor-pointer hover:shadow-lg',
        isSelected && 'ring-2 scale-[1.02]',
        isSelected && `ring-black dark:ring-white`,
        !isSelected && 'hover:shadow-md'
      )}
      onClick={() => !isEditMode && onSelect()}
    >
      {/* Strategy Header */}
      <CardHeader className={cn('pb-4 border-b-2', `bg-${colorScheme.bg} border-${colorScheme.border}`)}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className={cn('text-lg font-bold', `text-${colorScheme.text}`)}>
              {plan.strategyName}
            </h3>
            {isSelected && (
              <CheckCircle2 className={cn('h-5 w-5', `text-${colorScheme.icon}`)} />
            )}
          </div>
          
          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <DollarSign className={cn('h-4 w-4', `text-${colorScheme.icon}`)} />
              <div>
                <p className="text-xs text-muted-foreground">Total Cost</p>
                <p className="text-sm font-bold">
                  {plan.totalCost >= 1000
                    ? `$${Math.round(plan.totalCost / 1000)}K`
                    : `$${Math.round(plan.totalCost).toLocaleString()}`}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Clock className={cn('h-4 w-4', `text-${colorScheme.icon}`)} />
              <div>
                <p className="text-xs text-muted-foreground">Duration</p>
                <p className="text-sm font-bold">{durationValue} days</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Users className={cn('h-4 w-4', `text-${colorScheme.icon}`)} />
              <div>
                <p className="text-xs text-muted-foreground">Resource count</p>
                <p className="text-sm font-bold">{plan.teamSize} people</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {riskIcon}
              <div>
                <p className="text-xs text-muted-foreground">Risk</p>
                <p className="text-sm font-bold capitalize">{plan.riskLevel}</p>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-4 space-y-4">
        {/* AI Analysis */}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-between p-0 h-auto hover:bg-transparent"
            onClick={(e) => {
              e.stopPropagation();
              setAnalysisExpanded(!analysisExpanded);
            }}
          >
            <span className="text-sm font-semibold">AI Analysis</span>
            {analysisExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
          
          {analysisExpanded && (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Rationale
                </p>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  {plan.analysis.rationale}
                </p>
              </div>
              
              <div>
                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Trade-offs
                </p>
                <ul className="space-y-1">
                  {plan.analysis.tradeoffs.map((tradeoff, index) => (
                    <li key={index} className="text-slate-600 dark:text-slate-400 text-xs">
                      • {tradeoff}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div>
                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Expected Outcomes
                </p>
                <ul className="space-y-1">
                  {plan.analysis.expectedOutcomes.map((outcome, index) => (
                    <li key={index} className="text-slate-600 dark:text-slate-400 text-xs">
                      • {outcome}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        
        <Separator />
        
        {/* Resource Allocations */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">Resources</p>
            {!isEditMode && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditAllocations();
                }}
              >
                <Edit2 className="h-3 w-3 mr-1" />
                Customize
              </Button>
            )}
          </div>
          
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {displayAllocations.map((allocation) => (
              <div key={allocation.id}>
                {isEditMode ? (
                  <ResourceAllocationEditor
                    allocation={allocation}
                    onUpdate={(updates) => handleUpdateAllocation(allocation.id, updates)}
                    onRemove={() => handleRemoveAllocation(allocation.id)}
                  />
                ) : (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-900">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{allocation.userName}</p>
                      <p className="text-xs text-muted-foreground">{allocation.role}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {allocation.allocationPercentage}%
                    </Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Quick Stats */}
        <Separator />
        
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Avg Allocation</p>
            <p className="text-sm font-bold">{plan.metrics.avgAllocationPercentage}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Weekly Hours</p>
            <p className="text-sm font-bold">{plan.metrics.totalWeeklyHours}h</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Utilization</p>
            <p className="text-sm font-bold">{plan.metrics.utilizationRate}%</p>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {isEditMode ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetToAI();
                }}
              >
                Reset to AI
              </Button>
              <Button
                type="button"
                size="sm"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditMode(false);
                  onSelect();
                }}
              >
                Save Changes
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className={cn('w-full', `bg-black dark:bg-white text-white dark:text-black hover:bg-slate-800 dark:hover:bg-slate-200`)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
            >
              {isSelected ? 'Selected' : 'Select This Plan'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
