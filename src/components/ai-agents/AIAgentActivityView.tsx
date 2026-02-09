import { useAIAgentActivity } from '@/hooks/useAIAgents';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { Loader2 } from 'lucide-react';

interface AIAgentActivityViewProps {
  assignmentId?: string;
  limit?: number;
}

export default function AIAgentActivityView({ assignmentId, limit = 10 }: AIAgentActivityViewProps) {
  const { data: activities = [], isLoading } = useAIAgentActivity(assignmentId, limit);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!assignmentId || activities.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          No agent activity yet
        </CardContent>
      </Card>
    );
  }

  const getActivityBadgeColor = (type: string) => {
    switch (type) {
      case 'assigned':
        return 'default';
      case 'started':
        return 'secondary';
      case 'progress_update':
        return 'outline';
      case 'completed':
        return 'default';
      case 'failed':
        return 'destructive';
      case 'comment':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'assigned':
        return '📋';
      case 'started':
        return '▶️';
      case 'progress_update':
        return '⏳';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'comment':
        return '💬';
      default:
        return '📌';
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Agent Activity</h3>
      <div className="space-y-3">
        {activities.map((activity) => (
          <Card key={activity.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="text-xl mt-1">{getActivityIcon(activity.activityType)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{activity.title}</span>
                    <Badge variant={getActivityBadgeColor(activity.activityType) as any} className="text-xs">
                      {activity.activityType.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  {activity.description && (
                    <p className="text-sm text-muted-foreground mb-2">{activity.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
