import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  id: number;
  title: string;
  description?: string;
}

interface WizardProgressProps {
  steps: Step[];
  currentStep: number;
}

export function WizardProgress({ steps, currentStep }: WizardProgressProps) {
  return (
    <div className="w-full">
      {/* Progress bar */}
      <div className="relative mb-8">
        <div className="absolute top-5 left-0 w-full h-0.5 bg-slate-200 dark:bg-slate-700" />
        <div 
          className="absolute top-5 left-0 h-0.5 bg-black dark:bg-white transition-all duration-500"
          style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
        />
        
        <div className="relative flex justify-between">
          {steps.map((step) => {
            const isCompleted = step.id < currentStep;
            const isCurrent = step.id === currentStep;
            const isPending = step.id > currentStep;
            
            return (
              <div key={step.id} className="flex flex-col items-center">
                {/* Circle */}
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-300 z-10',
                    isCompleted && 'bg-black dark:bg-white text-white dark:text-black',
                    isCurrent && 'bg-black dark:bg-white text-white dark:text-black ring-4 ring-slate-100 dark:ring-slate-800',
                    isPending && 'bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 text-slate-400'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    step.id
                  )}
                </div>
                
                {/* Label */}
                <div className="mt-3 text-center max-w-[120px]">
                  <p className={cn(
                    'text-sm font-medium transition-colors',
                    isCurrent && 'text-black dark:text-white',
                    isCompleted && 'text-slate-700 dark:text-slate-300',
                    isPending && 'text-slate-400 dark:text-slate-500'
                  )}>
                    {step.title}
                  </p>
                  {step.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
