import { useState } from "react";
import { useUpdateSummary } from "@/hooks/useUpdateSummaries";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/useSubscription";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sparkles } from "lucide-react";

interface ProjectUpdateSummaryCardProps {
  projectId: string;
  desktopOnly?: boolean;
}

export function ProjectUpdateSummaryCard({ projectId, desktopOnly = false }: ProjectUpdateSummaryCardProps) {
  const { data: updateSummary } = useUpdateSummary(projectId);
  const { isFreePlan } = useSubscription();
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);

  if (!updateSummary?.updateSummary) {
    return null;
  }

  // Mobile popover
  if (!desktopOnly) {
    return (
      <div className="absolute top-2 left-2 z-10 sm:hidden">
        <Popover open={hoveredProject === projectId} onOpenChange={(open) => setHoveredProject(open ? projectId : null)}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={() => setHoveredProject(projectId)}
              onMouseLeave={() => setHoveredProject(null)}
              title="AI Progress Summary"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent 
            className="w-[calc(100vw-2rem)] max-w-sm max-h-[500px] overflow-y-auto" 
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => setHoveredProject(projectId)}
            onMouseLeave={() => setHoveredProject(null)}
            align="start"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground/70">LATEST PROGRESS SUMMARY</p>
                  {updateSummary?.dateId && (
                    <p className="text-xs text-muted-foreground/60">
                      {updateSummary.dateId}
                    </p>
                  )}
                </div>
                <div className={cn("relative", isFreePlan && "blur-sm pointer-events-none")}>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {updateSummary.updateSummary}
                  </p>
                  {isFreePlan && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                        Upgrade to view progress summary
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // Desktop card
  return (
    <div className="hidden sm:flex items-stretch gap-3 flex-1">
      {/* Visual Connector Line */}
      <div className="flex items-center justify-center w-4 flex-shrink-0">
        <div className="w-0.5 h-full min-h-[100px] bg-border group-hover:bg-primary/50 transition-colors rounded-full" />
      </div>
      <Card 
        className="flex-1 flex flex-col h-[120px] cursor-pointer group-hover:shadow-md transition-shadow overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="pb-3 flex-shrink-0">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground/70">LATEST PROGRESS SUMMARY</p>
              {updateSummary?.dateId && (
                <p className="text-xs text-muted-foreground/60">
                  {updateSummary.dateId}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
        <div className="px-6 pb-6 flex-1 min-h-0">
          <div className={cn("relative h-full max-h-[80px] overflow-y-auto", isFreePlan && "blur-sm pointer-events-none")}>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {updateSummary.updateSummary}
            </p>
            {isFreePlan && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                  Upgrade to view progress summary
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

