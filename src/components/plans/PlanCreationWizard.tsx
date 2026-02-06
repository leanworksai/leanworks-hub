import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowLeft, ArrowRight, Sparkles, Users as UsersIcon, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { WizardProgress } from './WizardProgress';
import { BasicInfoStep } from './wizard-steps/BasicInfoStep';
import { LinkProjectsStep } from './wizard-steps/LinkProjectsStep';
import { ReviewStep } from './wizard-steps/ReviewStep';
import { AIResourcePlanner } from './ai-resource/AIResourcePlanner';
import { ManualResourcePlanning } from './ai-resource/ManualResourcePlanning';
import type { Objective, ResourceAllocation } from '@/data/plansData';

interface PlanCreationWizardProps {
  onSubmit: (data: any) => void;
  onCancel: () => void;
}

const wizardSteps = [
  { id: 1, title: 'Basic Info', description: 'Plan details' },
  { id: 2, title: 'Link Projects', description: 'Connect projects' },
  { id: 3, title: 'Add Resources', description: 'Build your team' },
  { id: 4, title: 'Review', description: 'Finalize plan' },
];

export function PlanCreationWizard({ onSubmit, onCancel }: PlanCreationWizardProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [objectives, setObjectives] = useState<Partial<Objective>[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [resourceAllocations, setResourceAllocations] = useState<ResourceAllocation[]>([]);
  const [resourcePlanningMode, setResourcePlanningMode] = useState<'ai' | 'manual'>('ai');
  
  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      startDate: new Date(),
      endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      totalBudget: 0,
      currency: 'USD',
      ownerEmail: user?.email || '',
    },
  });

  useEffect(() => {
    if (user?.email && form.getValues('ownerEmail') !== user.email) {
      form.setValue('ownerEmail', user.email, { shouldValidate: true });
    }
  }, [user?.email, form]);
  
  const handleNext = async () => {
    // Validate current step
    if (currentStep === 1) {
      const isValid = await form.trigger(['name', 'startDate', 'endDate', 'totalBudget']);
      if (!isValid) return;
    }
    
    setCurrentStep((prev) => Math.min(prev + 1, wizardSteps.length));
  };
  
  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };
  
  const handleEditStep = (step: number) => {
    setCurrentStep(step);
  };
  
  const handleAISelectPlan = (allocations: ResourceAllocation[], strategy: 'cost' | 'time' | 'quality') => {
    setResourceAllocations(allocations);
    // Optionally auto-advance to review
    setTimeout(() => setCurrentStep(4), 500);
  };
  
  const handleSubmit = form.handleSubmit((data) => {
    const planData = {
      ...data,
      ownerEmail: user?.email || data.ownerEmail,
      totalBudget: typeof data.totalBudget === 'number' ? data.totalBudget : parseFloat(data.totalBudget) || 0,
      objectives: objectives.filter(o => o.text), // Only include objectives with text
      projectIds: selectedProjectIds,
      resourceAllocations,
      status: 'planning' as const,
      healthScore: 100,
      spentToDate: 0,
    };
    
    onSubmit(planData);
  });
  
  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return form.watch('name') && form.watch('startDate') && form.watch('endDate') && form.watch('totalBudget');
      case 2:
        return true; // Projects are optional
      case 3:
        return true; // Resources are optional
      case 4:
        return true;
      default:
        return false;
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Progress Indicator */}
      <WizardProgress steps={wizardSteps} currentStep={currentStep} />
      
      {/* Form Content */}
      <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="border-2">
            <CardContent className="pt-6">
              {/* Step 1: Basic Info */}
              {currentStep === 1 && (
                <BasicInfoStep
                  form={form}
                  objectives={objectives}
                  setObjectives={setObjectives}
                />
              )}
              
              {/* Step 2: Link Projects */}
              {currentStep === 2 && (
                <LinkProjectsStep
                  selectedProjectIds={selectedProjectIds}
                  setSelectedProjectIds={setSelectedProjectIds}
                />
              )}
              
              {/* Step 3: Add Resources */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-1">Resource Planning</h3>
                    <p className="text-sm text-muted-foreground">
                      Use AI to optimize your team or build it manually
                    </p>
                  </div>
                  
                  <Tabs value={resourcePlanningMode} onValueChange={(v) => setResourcePlanningMode(v as 'ai' | 'manual')}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="ai" className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        AI Planning
                      </TabsTrigger>
                      <TabsTrigger value="manual" className="flex items-center gap-2">
                        <UsersIcon className="h-4 w-4" />
                        Manual Planning
                      </TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="ai" className="mt-6">
                      <AIResourcePlanner
                        planContext={{
                          totalBudget: form.watch('totalBudget') || 0,
                          startDate: form.watch('startDate')?.toISOString().split('T')[0] || '',
                          endDate: form.watch('endDate')?.toISOString().split('T')[0] || '',
                          projectIds: selectedProjectIds,
                          objectives: objectives.filter(o => o.text),
                        }}
                        onSelectPlan={handleAISelectPlan}
                        onBack={() => setResourcePlanningMode('manual')}
                      />
                    </TabsContent>
                    
                    <TabsContent value="manual" className="mt-6">
                      <ManualResourcePlanning
                        resourceAllocations={resourceAllocations}
                        setResourceAllocations={setResourceAllocations}
                        planStartDate={form.watch('startDate') || new Date()}
                        planEndDate={form.watch('endDate') || new Date()}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              )}
              
              {/* Step 4: Review */}
              {currentStep === 4 && (
                <ReviewStep
                  formData={form.getValues()}
                  objectives={objectives}
                  selectedProjectIds={selectedProjectIds}
                  resourceAllocations={resourceAllocations}
                  onEditStep={handleEditStep}
                />
              )}
            </CardContent>
          </Card>
          
          {/* Navigation Buttons */}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={currentStep === 1 ? onCancel : handleBack}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {currentStep === 1 ? 'Cancel' : 'Back'}
            </Button>
            
            <div className="flex items-center gap-2">
              {currentStep < wizardSteps.length ? (
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={!canProceed()}
                >
                  Next
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!canProceed()}
                  className="bg-black dark:bg-white text-white dark:text-black hover:bg-slate-800 dark:hover:bg-slate-200"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Create Plan
                </Button>
              )}
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
