import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResourceAllocation } from '@/data/plansData';

interface ResourceAllocationTimelineProps {
  allocations: ResourceAllocation[];
  startDate: string;
  endDate: string;
}

interface GroupedAllocation {
  userId: string;
  userEmail: string;
  userName: string;
  allocations: ResourceAllocation[];
  totalPercentage: number;
  isOverallocated: boolean;
}

export function ResourceAllocationTimeline({ 
  allocations, 
  startDate, 
  endDate 
}: ResourceAllocationTimelineProps) {
  // Group allocations by user
  const groupedAllocations = useMemo(() => {
    const grouped = new Map<string, GroupedAllocation>();
    
    allocations.forEach(alloc => {
      const existing = grouped.get(alloc.userId);
      if (existing) {
        existing.allocations.push(alloc);
        existing.totalPercentage += alloc.allocationPercentage;
      } else {
        grouped.set(alloc.userId, {
          userId: alloc.userId,
          userEmail: alloc.userEmail,
          userName: alloc.userName,
          allocations: [alloc],
          totalPercentage: alloc.allocationPercentage,
          isOverallocated: false,
        });
      }
    });
    
    // Mark overallocations
    grouped.forEach(group => {
      group.isOverallocated = group.totalPercentage > 100;
    });
    
    return Array.from(grouped.values());
  }, [allocations]);
  
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };
  
  const getAllocationColor = (percentage: number) => {
    if (percentage <= 50) return 'bg-green-500';
    if (percentage <= 80) return 'bg-blue-500';
    if (percentage <= 100) return 'bg-yellow-500';
    return 'bg-red-500';
  };
  
  const getAllocationIntensity = (percentage: number) => {
    const intensity = Math.min(percentage / 100, 1);
    return intensity;
  };
  
  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resource Allocation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-green-500" />
              <span className="text-muted-foreground">0-50%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-blue-500" />
              <span className="text-muted-foreground">51-80%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-yellow-500" />
              <span className="text-muted-foreground">81-100%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-500" />
              <span className="text-muted-foreground">&gt;100%</span>
            </div>
          </div>
          
          {/* Resource list */}
          <div className="space-y-4">
            {groupedAllocations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No resources allocated yet
              </p>
            ) : (
              groupedAllocations.map((group) => (
                <div key={group.userId} className="space-y-2">
                  {/* User header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {getInitials(group.userName)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{group.userName}</p>
                        <p className="text-xs text-muted-foreground">{group.userEmail}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {group.isOverallocated && (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                      <span className={cn(
                        'text-sm font-semibold',
                        group.isOverallocated ? 'text-red-600' : 'text-foreground'
                      )}>
                        {group.totalPercentage}%
                      </span>
                    </div>
                  </div>
                  
                  {/* Allocation bars */}
                  <div className="space-y-1 pl-10">
                    {group.allocations.map((alloc) => (
                      <div key={alloc.id} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{alloc.role}</span>
                          <span className="text-muted-foreground">
                            {formatDateRange(alloc.startDate, alloc.endDate)}
                          </span>
                        </div>
                        <div className="relative h-6 w-full bg-gray-200 rounded overflow-hidden">
                          <div
                            className={cn(
                              'h-full transition-all duration-500 flex items-center justify-center',
                              getAllocationColor(alloc.allocationPercentage)
                            )}
                            style={{ 
                              width: `${Math.min(alloc.allocationPercentage, 100)}%`,
                              opacity: getAllocationIntensity(alloc.allocationPercentage),
                            }}
                          >
                            <span className="text-xs font-semibold text-white">
                              {alloc.allocationPercentage}%
                            </span>
                          </div>
                          {alloc.allocationPercentage > 100 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-bold text-red-600 bg-white px-2 rounded">
                                {alloc.allocationPercentage}% OVERALLOCATED
                              </span>
                            </div>
                          )}
                        </div>
                        {alloc.hourlyRate && (
                          <p className="text-xs text-muted-foreground">
                            ${alloc.hourlyRate}/hr
                            {alloc.normalizedHours && (
                              <span> • ~{alloc.normalizedHours}hrs/week capacity</span>
                            )}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          
          {/* Summary stats */}
          {groupedAllocations.length > 0 && (
            <div className="pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Resources</span>
                <span className="font-semibold">{groupedAllocations.length}</span>
              </div>
              {groupedAllocations.some(g => g.isOverallocated) && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Overallocated</span>
                  <span className="font-semibold text-red-600">
                    {groupedAllocations.filter(g => g.isOverallocated).length}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Average Allocation</span>
                <span className="font-semibold">
                  {Math.round(groupedAllocations.reduce((sum, g) => sum + g.totalPercentage, 0) / groupedAllocations.length)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
