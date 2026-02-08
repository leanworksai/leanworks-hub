import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { ResourceAllocation } from '@/types/plans';

interface ResourceAllocationEditorProps {
  allocation: ResourceAllocation;
  onUpdate: (updates: Partial<ResourceAllocation>) => void;
  onRemove: () => void;
}

export function ResourceAllocationEditor({
  allocation,
  onUpdate,
  onRemove,
}: ResourceAllocationEditorProps) {
  const handleSliderChange = (value: number[]) => {
    onUpdate({ allocationPercentage: value[0] });
  };
  
  const handleInputChange = (value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
      onUpdate({ allocationPercentage: numValue });
    }
  };
  
  const isOverallocated = allocation.allocationPercentage > 100;
  const isUnderutilized = allocation.allocationPercentage < 20;
  
  return (
    <div
      className={cn(
        'p-3 rounded-lg border-2 transition-colors',
        isOverallocated && 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20',
        !isOverallocated && 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-3">
          {/* Name and Role */}
          <div>
            <p className="text-sm font-medium truncate">{allocation.userName}</p>
            <p className="text-xs text-muted-foreground">{allocation.role}</p>
          </div>
          
          {/* Allocation Slider */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Slider
                value={[allocation.allocationPercentage]}
                onValueChange={handleSliderChange}
                max={150}
                step={5}
                className="flex-1"
              />
              <Input
                type="number"
                value={allocation.allocationPercentage}
                onChange={(e) => handleInputChange(e.target.value)}
                className="w-16 h-8 text-center"
                min={0}
                max={150}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            
            {/* Visual indicator */}
            <div className="flex items-center gap-1 text-xs">
              <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all rounded-full',
                    isOverallocated && 'bg-red-500',
                    !isOverallocated && allocation.allocationPercentage >= 80 && 'bg-amber-500',
                    !isOverallocated && allocation.allocationPercentage < 80 && 'bg-black dark:bg-white'
                  )}
                  style={{ width: `${Math.min(allocation.allocationPercentage, 100)}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* Warnings */}
          {isOverallocated && (
            <div className="flex items-start gap-2 p-2 rounded bg-red-100 dark:bg-red-950/30">
              <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-800 dark:text-red-200">
                Over-allocated: This person is assigned more than 100% of their time
              </p>
            </div>
          )}
          
          {isUnderutilized && !isOverallocated && (
            <div className="flex items-start gap-2 p-2 rounded bg-amber-100 dark:bg-amber-950/30">
              <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Under-utilized: Consider increasing allocation or removing from plan
              </p>
            </div>
          )}
          
          {/* Additional info */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{allocation.normalizedHours}h/week capacity</span>
            <span>
              {Math.round((allocation.normalizedHours || 40) * (allocation.allocationPercentage / 100))}h/week on this plan
            </span>
          </div>
        </div>
        
        {/* Remove button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
