import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sparkles } from "lucide-react";
import { useUpdatesByTaskId } from "@/hooks/useUpdates";
import { useSubscription } from "@/hooks/useSubscription";
import { cn } from "@/lib/utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatDateInTimezone } from "@/lib/dateTimeUtils";

// TaskTooltip component to show updates and reason
export function TaskTooltip({ taskId, taskReason }: { taskId: string; taskReason?: string }) {
  const [isHovered, setIsHovered] = useState(false);
  const { data: updates = [], isLoading } = useUpdatesByTaskId(isHovered ? taskId : null);
  const { isFreePlan } = useSubscription();
  const userTimezone = useUserTimezone();
  
  // Only show tooltip if there's a reason (updates will be fetched on hover)
  if (!taskReason) {
    return null;
  }
  
  // Get the latest update (updates are already sorted by timestamp descending)
  const latestUpdate = updates && updates.length > 0 ? updates[0] : null;
  
  return (
    <Popover open={isHovered} onOpenChange={(open) => setIsHovered(open)}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          title="AI Updates & Reason"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-96 max-h-[500px] overflow-y-auto" 
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        align="start"
      >
        <div className="space-y-4">
          {/* Show loading state */}
          {isLoading && (
            <div className="text-xs text-muted-foreground">Loading updates...</div>
          )}
          
          {/* Latest Progress Updates */}
          {!isLoading && latestUpdate && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground/70">LATEST PROGRESS UPDATE</p>
                {latestUpdate.timestamp && (
                  <p className="text-xs text-muted-foreground/60">
                    {formatDateInTimezone(latestUpdate.timestamp, userTimezone)}
                  </p>
                )}
              </div>
              <div className={cn("relative", isFreePlan && "blur-sm pointer-events-none")}>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {latestUpdate.update}
                </p>
                {isFreePlan && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                      Upgrade to view progress update
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Reason - from latest update if available, otherwise from task */}
          {!isLoading && (latestUpdate?.reason || taskReason) && (
            <div className="space-y-2">
              {latestUpdate && <div className="border-t border-border pt-2" />}
              <p className="text-xs font-medium text-muted-foreground/70">REASON</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {latestUpdate?.reason || taskReason}
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

