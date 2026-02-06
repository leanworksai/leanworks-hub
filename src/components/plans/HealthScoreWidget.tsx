import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { HealthScoreBreakdown } from '@/utils/planCalculations';

interface HealthScoreWidgetProps {
  score: number;
  trend?: 'up' | 'down' | 'stable';
  breakdown?: HealthScoreBreakdown;
  size?: 'sm' | 'md' | 'lg';
  showTrend?: boolean;
}

export function HealthScoreWidget({ 
  score, 
  trend = 'stable', 
  breakdown,
  size = 'md',
  showTrend = true,
}: HealthScoreWidgetProps) {
  // Determine color based on score
  const getColor = (score: number) => {
    if (score >= 71) return 'text-green-600';
    if (score >= 41) return 'text-yellow-600';
    return 'text-red-600';
  };
  
  const getBgColor = (score: number) => {
    if (score >= 71) return 'bg-green-100';
    if (score >= 41) return 'bg-yellow-100';
    return 'bg-red-100';
  };
  
  const getStrokeColor = (score: number) => {
    if (score >= 71) return 'stroke-green-600';
    if (score >= 41) return 'stroke-yellow-600';
    return 'stroke-red-600';
  };
  
  // Size configurations
  const sizeConfig = {
    sm: { radius: 20, strokeWidth: 4, fontSize: 'text-sm', containerSize: 'w-12 h-12' },
    md: { radius: 35, strokeWidth: 6, fontSize: 'text-lg', containerSize: 'w-24 h-24' },
    lg: { radius: 50, strokeWidth: 8, fontSize: 'text-2xl', containerSize: 'w-32 h-32' },
  };
  
  const config = sizeConfig[size];
  const circumference = 2 * Math.PI * config.radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-400';
  
  const widget = (
    <div className="flex flex-col items-center gap-1">
      <div className={cn('relative flex items-center justify-center', config.containerSize)}>
        {/* Background circle */}
        <svg className="absolute" width="100%" height="100%" viewBox={`0 0 ${config.radius * 2 + config.strokeWidth * 2} ${config.radius * 2 + config.strokeWidth * 2}`}>
          <circle
            cx={config.radius + config.strokeWidth}
            cy={config.radius + config.strokeWidth}
            r={config.radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={config.strokeWidth}
            className="text-gray-200"
          />
          {/* Progress circle */}
          <circle
            cx={config.radius + config.strokeWidth}
            cy={config.radius + config.strokeWidth}
            r={config.radius}
            fill="none"
            strokeWidth={config.strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={cn(getStrokeColor(score), 'transition-all duration-500')}
            transform={`rotate(-90 ${config.radius + config.strokeWidth} ${config.radius + config.strokeWidth})`}
          />
        </svg>
        
        {/* Score text */}
        <div className={cn('font-bold', getColor(score), config.fontSize)}>
          {score}
        </div>
      </div>
      
      {/* Trend indicator */}
      {showTrend && (
        <div className={cn('flex items-center gap-0.5', trendColor)}>
          <TrendIcon className="h-3 w-3" />
          <span className="text-xs font-medium">
            {trend === 'up' ? 'Up' : trend === 'down' ? 'Down' : 'Stable'}
          </span>
        </div>
      )}
    </div>
  );
  
  // If breakdown is provided, wrap in tooltip
  if (breakdown) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {widget}
          </TooltipTrigger>
          <TooltipContent className="w-64">
            <div className="space-y-2">
              <p className="font-semibold text-sm">Health Score Breakdown</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeline:</span>
                  <span className={getColor(breakdown.timeline)}>{breakdown.timeline}/100</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Budget:</span>
                  <span className={getColor(breakdown.budget)}>{breakdown.budget}/100</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resources:</span>
                  <span className={getColor(breakdown.resources)}>{breakdown.resources}/100</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Objectives:</span>
                  <span className={getColor(breakdown.objectives)}>{breakdown.objectives}/100</span>
                </div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return widget;
}
