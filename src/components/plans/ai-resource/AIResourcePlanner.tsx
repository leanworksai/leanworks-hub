import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ResourcePlanCard } from './ResourcePlanCard';
import { generateResourcePlans } from '@/utils/aiResourcePlanner';
import type { AIResourcePlan } from '@/utils/aiResourcePlanner';
import type { Plan, ResourceAllocation } from '@/types/plans';

interface AIResourcePlannerProps {
  userId: string;
  orgSlug: string;
  planContext: {
    name: string;
    totalBudget: number;
    currency?: string;
    startDate: string;
    endDate: string;
    projectIds: string[];
    objectives: any[];
    budgetCategories?: any[];
  };
  onSelectPlan: (allocations: ResourceAllocation[], strategy: 'cost' | 'time' | 'quality') => void;
  onBack: () => void;
}

export function AIResourcePlanner({ userId, orgSlug, planContext, onSelectPlan, onBack }: AIResourcePlannerProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPlans, setGeneratedPlans] = useState<AIResourcePlan[] | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Analyzing team capabilities...');
  const [selectedStrategy, setSelectedStrategy] = useState<'cost' | 'time' | 'quality' | null>(null);
  
  const generatePlans = async () => {
    if (!userId || !orgSlug) {
      setGeneratedPlans(null);
      setIsGenerating(false);
      return;
    }
    setIsGenerating(true);
    setLoadingMessage('Analyzing team capabilities...');
    
    // Simulate AI processing with loading messages
    await new Promise(resolve => setTimeout(resolve, 800));
    setLoadingMessage('Calculating optimal allocations...');
    
    await new Promise(resolve => setTimeout(resolve, 800));
    setLoadingMessage('Generating strategies...');
    
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Generate the actual plans
    const plan: Plan = {
      id: 'new-plan',
      name: planContext.name,
      description: '',
      objectives: planContext.objectives || [],
      totalBudget: planContext.totalBudget,
      currency: planContext.currency || 'USD',
      budgetCategories: planContext.budgetCategories || [],
      spentToDate: 0,
      startDate: planContext.startDate,
      endDate: planContext.endDate,
      projectIds: planContext.projectIds || [],
      resourceAllocations: [],
      milestones: [],
      status: 'planning',
      healthScore: 100,
      healthTrend: 'stable',
      ownerEmail: userId,
      ownerName: '',
      teamSize: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recentActivity: [],
    };

    const plans = await generateResourcePlans(userId, orgSlug, plan);
    setGeneratedPlans(plans);
    setIsGenerating(false);
  };
  
  const handleSelectPlan = (plan: AIResourcePlan) => {
    setSelectedStrategy(plan.strategy);
    onSelectPlan(plan.allocations as ResourceAllocation[], plan.strategy);
  };

  // Initial state: no plans yet, user must click Generate
  if (generatedPlans === null && !isGenerating) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Generate AI-powered resource allocation strategies for this plan.
          </p>
          <Button
            type="button"
            className="mt-6"
            onClick={generatePlans}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="relative">
          <Sparkles className="h-16 w-16 text-black dark:text-white animate-pulse" />
          <Loader2 className="absolute inset-0 h-16 w-16 text-slate-400 animate-spin" style={{ animationDuration: '3s' }} />
        </div>
        <p className="mt-6 text-lg font-medium text-slate-700 dark:text-slate-300">
          {loadingMessage}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          This will take just a moment...
        </p>
      </div>
    );
  }

  // API returned empty or failed
  if (!generatedPlans || generatedPlans.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Sparkles className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-sm text-muted-foreground">Failed to generate plans</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={generatePlans}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-black dark:text-white" />
            AI Resource Planning - Choose Your Strategy
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Compare three optimized strategies and select the best fit for your plan
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={generatePlans}
        >
          <Sparkles className="h-4 w-4 mr-1" />
          Regenerate
        </Button>
      </div>
      
      {/* Three-Column Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {generatedPlans.map((plan) => (
          <ResourcePlanCard
            key={plan.strategy}
            plan={plan}
            isSelected={selectedStrategy === plan.strategy}
            onSelect={() => handleSelectPlan(plan)}
          />
        ))}
      </div>
      
      {/* Helper text */}
      <Card className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <CardContent className="p-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <strong>Tip:</strong> Each strategy optimizes for different priorities. Cost-optimized 
            uses fewer resources over a longer timeline, Time-optimized delivers faster with more team 
            members, and Quality-focused balances both for sustainable delivery.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
