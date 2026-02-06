import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PlanCreationWizard } from '@/components/plans/PlanCreationWizard';
import { useCreatePlan } from '@/hooks/usePlans';
import { useUsers } from '@/hooks/useUsers';
import { useToast } from '@/hooks/use-toast';

interface NewPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewPlanDialog({ open, onOpenChange }: NewPlanDialogProps) {
  const { toast } = useToast();
  const createPlan = useCreatePlan();
  const { data: users = [] } = useUsers();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (data: any) => {
    setIsSubmitting(true);
    
    try {
      // Find owner name
      const owner = users.find(u => u.email === data.ownerEmail);
      const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : data.ownerEmail;
      
      await createPlan.mutateAsync({
        name: data.name,
        description: data.description,
        totalBudget: data.totalBudget,
        currency: data.currency,
        startDate: data.startDate.toISOString(),
        endDate: data.endDate.toISOString(),
        ownerEmail: data.ownerEmail,
        ownerName,
        objectives: data.objectives || [],
        projectIds: data.projectIds || [],
        resourceAllocations: data.resourceAllocations || [],
        budgetCategories: [],
        status: data.status,
        healthScore: data.healthScore,
        spentToDate: data.spentToDate,
      });
      
      toast({
        title: 'Plan created',
        description: `${data.name} has been created successfully.`,
      });
      
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create plan:', error);
      toast({
        title: 'Error',
        description: 'Failed to create plan. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Plan</DialogTitle>
          <DialogDescription>
            Create a strategic plan with objectives, linked projects, and AI-powered resource allocation.
          </DialogDescription>
        </DialogHeader>
        
        <PlanCreationWizard
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
