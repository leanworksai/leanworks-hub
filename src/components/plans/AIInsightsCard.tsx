import { Sparkles, AlertTriangle, Lightbulb, TrendingUp, MessageSquare, ChevronRight, Activity, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AIInsight } from '@/utils/aiInsightsGenerator';

interface AIInsightsCardProps {
  insights: AIInsight[];
  onAskAI?: () => void;
}

export function AIInsightsCard({ insights, onAskAI }: AIInsightsCardProps) {
  const getIcon = (type: AIInsight['type']) => {
    switch (type) {
      case 'summary':
        return Activity;
      case 'risk':
        return AlertTriangle;
      case 'recommendation':
        return Lightbulb;
      case 'prediction':
        return TrendingUp;
      default:
        return Sparkles;
    }
  };
  
  const getSeverityBadge = (severity?: 'low' | 'medium' | 'high') => {
    if (!severity) return null;
    
    const variants = {
      high: 'destructive',
      medium: 'warning', // We'll style this manually since 'warning' isn't a standard variant
      low: 'secondary',
    };
    
    const styles = {
      high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100/80",
      medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 hover:bg-amber-100/80",
      low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-100/80",
    };
    
    return (
      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5 border-0 font-medium", styles[severity])}>
        {severity.toUpperCase()}
      </Badge>
    );
  };
  
  // Group insights by type
  const summary = insights.find(i => i.type === 'summary');
  const risks = insights.filter(i => i.type === 'risk');
  const recommendations = insights.filter(i => i.type === 'recommendation');
  const predictions = insights.filter(i => i.type === 'prediction');
  
  return (
    <Card className="overflow-hidden border-0 shadow-sm bg-gradient-to-br from-white to-slate-50 dark:from-slate-950 dark:to-slate-900 ring-1 ring-slate-200 dark:ring-slate-800">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500" />
      
      <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800/50 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
              <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-violet-600 to-indigo-600 dark:from-violet-400 dark:to-indigo-400">
                AI Strategic Analysis
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Real-time insights based on plan execution data
              </CardDescription>
            </div>
          </div>
          {onAskAI && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onAskAI}
              className="gap-2 text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:text-violet-400 dark:hover:text-violet-300 dark:hover:bg-violet-900/20"
            >
              <MessageSquare className="h-4 w-4" />
              Ask AI Assistant
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-slate-800">
          
          {/* Left Column: Summary & Risks */}
          <div className="p-5 space-y-6">
            {/* Summary Section */}
            {summary && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Activity className="h-4 w-4 text-slate-500" />
                  <h3>Executive Summary</h3>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {summary.description}
                </div>
              </div>
            )}
            
            {/* Risks Section */}
            {risks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <h3>Risk Assessment</h3>
                  </div>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/50">
                    {risks.length} Detected
                  </Badge>
                </div>
                
                <div className="space-y-3">
                  {risks.slice(0, 3).map((risk) => (
                    <div key={risk.id} className="group relative p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-amber-200 dark:hover:border-amber-800/50 hover:bg-amber-50/30 dark:hover:bg-amber-900/10 transition-all duration-200">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <h4 className="text-sm font-medium text-slate-800 dark:text-slate-200 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">
                          {risk.title}
                        </h4>
                        {getSeverityBadge(risk.severity)}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {risk.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Right Column: Recommendations & Predictions */}
          <div className="p-5 space-y-6 bg-slate-50/30 dark:bg-slate-900/30">
            {/* Recommendations Section */}
            {recommendations.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Zap className="h-4 w-4 text-violet-500" />
                  <h3>Strategic Recommendations</h3>
                </div>
                
                <div className="space-y-3">
                  {recommendations.slice(0, 2).map((rec) => (
                    <div key={rec.id} className="flex gap-3 p-3 rounded-lg bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 shadow-sm">
                      <div className="mt-0.5 p-1.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 shrink-0">
                        <Lightbulb className="h-3.5 w-3.5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          {rec.title}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {rec.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Predictions Section */}
            {predictions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  <h3>Forecast & Trends</h3>
                </div>
                
                <div className="space-y-2">
                  {predictions.map((pred) => (
                    <div key={pred.id} className="flex items-start gap-3 p-3 rounded-lg border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-900/10">
                      <div className="mt-0.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                          {pred.title}
                        </h4>
                        <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 leading-relaxed">
                          {pred.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Empty State */}
        {insights.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-800 mb-3">
              <Sparkles className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">No insights available yet</h3>
            <p className="text-xs text-slate-500 max-w-xs mt-1">
              AI analysis will appear here once there is enough data from project execution.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
