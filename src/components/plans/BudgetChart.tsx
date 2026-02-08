import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BudgetCategory } from '@/types/plans';

interface BudgetChartProps {
  categories: BudgetCategory[];
  totalBudget: number;
  spentToDate: number;
  currency?: string;
}

export function BudgetChart({ 
  categories, 
  totalBudget, 
  spentToDate, 
  currency = 'USD' 
}: BudgetChartProps) {
  const remaining = totalBudget - spentToDate;
  const utilization = (spentToDate / totalBudget) * 100;
  
  // Prepare chart data with colors
  const chartData = useMemo(() => {
    const colors = [
      'hsl(var(--chart-1))',
      'hsl(var(--chart-2))',
      'hsl(var(--chart-3))',
      'hsl(var(--chart-4))',
      'hsl(var(--chart-5))',
    ];
    
    return categories.map((cat, index) => ({
      ...cat,
      color: colors[index % colors.length],
      percentage: (cat.allocatedAmount / totalBudget) * 100,
      utilized: (cat.spentAmount / cat.allocatedAmount) * 100,
    }));
  }, [categories, totalBudget]);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget Allocation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold">{formatCurrency(totalBudget)}</p>
            <p className="text-xs text-muted-foreground">Total Budget</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-600">{formatCurrency(spentToDate)}</p>
            <p className="text-xs text-muted-foreground">Spent</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(remaining)}</p>
            <p className="text-xs text-muted-foreground">Remaining</p>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Overall Utilization</span>
            <span className="font-semibold">{utilization.toFixed(1)}%</span>
          </div>
          <div className="h-4 w-full bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 transition-all duration-500"
              style={{ width: `${Math.min(utilization, 100)}%` }}
            />
          </div>
        </div>
        
        {/* Category breakdown */}
        <div className="space-y-3">
          <p className="text-sm font-semibold">Budget by Category</p>
          {chartData.map((cat) => (
            <div key={cat.id} className="space-y-1">
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: cat.color }}
                  />
                  <span>{cat.name}</span>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="text-muted-foreground">{formatCurrency(cat.spentAmount)}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-medium">{formatCurrency(cat.allocatedAmount)}</span>
                </div>
              </div>
              <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-500"
                  style={{ 
                    width: `${Math.min(cat.utilized, 100)}%`,
                    backgroundColor: cat.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        
        {/* Budget status indicator */}
        <div className="pt-4 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Budget Health</span>
            <span className={`font-semibold ${
              utilization < 75 ? 'text-green-600' :
              utilization < 90 ? 'text-yellow-600' :
              'text-red-600'
            }`}>
              {utilization < 75 ? 'Healthy' : utilization < 90 ? 'Monitor' : 'Critical'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
