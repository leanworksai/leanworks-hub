import { useState } from 'react';
import { Plus, X, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type { Objective } from '@/types/plans';
import type { UseFormReturn } from 'react-hook-form';

interface BasicInfoStepProps {
  form: UseFormReturn<any>;
  objectives: Partial<Objective>[];
  setObjectives: (objectives: Partial<Objective>[]) => void;
}

export function BasicInfoStep({ form, objectives, setObjectives }: BasicInfoStepProps) {
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  
  // Watch startDate to ensure endDate validation is reactive
  const startDate = form.watch('startDate');
  
  const formatDate = (date: Date | undefined): string => {
    if (!date) return 'Pick a date';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };
  
  const addObjective = () => {
    setObjectives([
      ...objectives,
      {
        id: `temp-${Date.now()}`,
        text: '',
        targetValue: 0,
        currentValue: 0,
        unit: 'percentage',
        status: 'on-track',
      },
    ]);
  };
  
  const removeObjective = (index: number) => {
    setObjectives(objectives.filter((_, i) => i !== index));
  };
  
  const updateObjective = (index: number, field: keyof Objective, value: any) => {
    const updated = [...objectives];
    updated[index] = { ...updated[index], [field]: value };
    setObjectives(updated);
  };
  
  return (
    <div className="space-y-6">
      {/* Plan Name */}
      <FormField
        control={form.control}
        name="name"
        rules={{ required: 'Plan name is required' }}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Plan Name *</FormLabel>
            <FormControl>
              <Input placeholder="Q1 2026 Product Launch" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      
      {/* Description */}
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Describe the plan's purpose and goals..."
                rows={3}
                {...field}
              />
            </FormControl>
            <FormDescription>
              A brief overview of what this plan aims to achieve
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      
      {/* Timeline */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="startDate"
          rules={{ required: 'Start date is required' }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Start Date *</FormLabel>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen} modal={true}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {formatDate(field.value)}
                      <Calendar className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={field.value}
                    onSelect={(date) => {
                      field.onChange(date);
                      setStartDateOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="endDate"
          rules={{ required: 'End date is required' }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>End Date *</FormLabel>
              <Popover open={endDateOpen} onOpenChange={setEndDateOpen} modal={true}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {formatDate(field.value)}
                      <Calendar className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={field.value}
                    onSelect={(date) => {
                      field.onChange(date);
                      setEndDateOpen(false);
                    }}
                    disabled={(date) => {
                      return startDate ? date < startDate : false;
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      
      {/* Budget */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <FormField
            control={form.control}
            name="totalBudget"
            rules={{
              required: 'Budget is required',
              min: { value: 0, message: 'Budget must be positive' },
            }}
            render={({ field }) => (
            <FormItem>
              <FormLabel>Total Budget *</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="100000"
                  {...field}
                  onChange={(e) => {
                    const value = e.target.value;
                    field.onChange(value === '' ? '' : parseFloat(value));
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
            )}
          />
        </div>
        
        <FormField
          control={form.control}
          name="currency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Currency</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      
      {/* Owner field removed - automatically set to current user */}
      
      {/* Objectives */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <FormLabel>Objectives (Optional)</FormLabel>
            <p className="text-xs text-muted-foreground mt-1">
              Define measurable goals for this plan
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addObjective}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Objective
          </Button>
        </div>
        
        {objectives.length === 0 ? (
          <div className="p-6 border-2 border-dashed rounded-lg text-center">
            <p className="text-sm text-muted-foreground">
              No objectives added yet. Click "Add Objective" to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {objectives.map((objective, index) => (
              <div key={index} className="p-4 border rounded-lg bg-slate-50 dark:bg-slate-900 space-y-3">
                <div className="flex items-start gap-2">
                  <Input
                    placeholder="e.g., Acquire 10,000 active users"
                    value={objective.text || ''}
                    onChange={(e) => updateObjective(index, 'text', e.target.value)}
                    className="flex-1 bg-white dark:bg-slate-950"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeObjective(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    placeholder="Target value"
                    value={objective.targetValue || 0}
                    onChange={(e) =>
                      updateObjective(index, 'targetValue', parseFloat(e.target.value) || 0)
                    }
                    className="bg-white dark:bg-slate-950"
                  />
                  <Select
                    value={objective.unit}
                    onValueChange={(value) => updateObjective(index, 'unit', value)}
                  >
                    <SelectTrigger className="bg-white dark:bg-slate-950">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="count">Count</SelectItem>
                      <SelectItem value="currency">Currency ($)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
