import { useState } from 'react';
import { Plus, X, AlertCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { useUsers } from '@/hooks/useUsers';
import { getUserPerformance, getAvailableUsers } from '@/data/userPerformanceData';
import { cn } from '@/lib/utils';
import type { ResourceAllocation } from '@/data/plansData';

interface ManualResourcePlanningProps {
  resourceAllocations: ResourceAllocation[];
  setResourceAllocations: (allocations: ResourceAllocation[]) => void;
  planStartDate: Date;
  planEndDate: Date;
}

export function ManualResourcePlanning({
  resourceAllocations,
  setResourceAllocations,
  planStartDate,
  planEndDate,
}: ManualResourcePlanningProps) {
  const { data: users = [] } = useUsers();
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [allocationPercentage, setAllocationPercentage] = useState<number>(50);
  
  const availableUsersData = getAvailableUsers(0);
  const availableUserEmails = availableUsersData.map(u => u.userEmail);
  const availableUsers = users.filter(u => availableUserEmails.includes(u.email));
  
  const handleAddResource = () => {
    if (!selectedUserId || !selectedRole) return;
    
    const user = users.find(u => u.email === selectedUserId);
    const performanceData = getUserPerformance(selectedUserId);
    
    if (!user || !performanceData) return;
    
    const newAllocation: ResourceAllocation = {
      id: `alloc-${Date.now()}-${Math.random()}`,
      userId: user.email,
      userName: user.name,
      userEmail: user.email,
      planId: '', // Will be set when plan is created
      projectId: undefined,
      role: selectedRole,
      allocationPercentage,
      startDate: planStartDate.toISOString().split('T')[0],
      endDate: planEndDate.toISOString().split('T')[0],
      normalizedHours: performanceData.normalizedHours,
      hourlyRate: performanceData.hourlyRate,
    };
    
    setResourceAllocations([...resourceAllocations, newAllocation]);
    
    // Reset form
    setSelectedUserId('');
    setSelectedRole('');
    setAllocationPercentage(50);
  };
  
  const handleRemoveResource = (id: string) => {
    setResourceAllocations(resourceAllocations.filter(a => a.id !== id));
  };
  
  const handleUpdateAllocation = (id: string, percentage: number) => {
    setResourceAllocations(
      resourceAllocations.map(a =>
        a.id === id ? { ...a, allocationPercentage: percentage } : a
      )
    );
  };
  
  // Calculate aggregated stats
  const totalTeamMembers = resourceAllocations.length;
  const avgAllocation = totalTeamMembers > 0
    ? Math.round(resourceAllocations.reduce((sum, a) => sum + a.allocationPercentage, 0) / totalTeamMembers)
    : 0;
  const totalWeeklyHours = resourceAllocations.reduce(
    (sum, a) => sum + ((a.normalizedHours || 40) * (a.allocationPercentage / 100)),
    0
  );
  
  // Check for over-allocations
  const userAllocations = new Map<string, number>();
  resourceAllocations.forEach(alloc => {
    const current = userAllocations.get(alloc.userId) || 0;
    userAllocations.set(alloc.userId, current + alloc.allocationPercentage);
  });
  
  const overallocatedUsers = Array.from(userAllocations.entries())
    .filter(([_, total]) => total > 100)
    .map(([userId, total]) => {
      const alloc = resourceAllocations.find(a => a.userId === userId);
      return { name: alloc?.userName || 'Unknown', total };
    });
  
  const commonRoles = [
    'Product Manager',
    'Tech Lead',
    'Senior Engineer',
    'Engineer',
    'Junior Engineer',
    'Designer',
    'QA Engineer',
    'DevOps Engineer',
    'Data Analyst',
  ];
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Manual Resource Planning</h3>
        <p className="text-sm text-muted-foreground">
          Build your team by selecting people and assigning roles
        </p>
      </div>
      
      {/* Add Resource Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Team Member
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* User Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Person</label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a person..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((user) => {
                    const perf = getUserPerformance(user.email);
                    const isAlreadyAdded = resourceAllocations.some(a => a.userId === user.email);
                    
                    return (
                      <SelectItem key={user.email} value={user.email} disabled={isAlreadyAdded}>
                        <div className="flex items-center justify-between gap-2">
                          <span>{user.name}</span>
                          {perf && (
                            <Badge variant="outline" className="text-xs">
                              {perf.availability}% available
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            
            {/* Role Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role..." />
                </SelectTrigger>
                <SelectContent>
                  {commonRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Allocation Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Allocation Percentage</label>
              <span className="text-sm font-bold text-black dark:text-white">
                {allocationPercentage}%
              </span>
            </div>
            <Slider
              value={[allocationPercentage]}
              onValueChange={(value) => setAllocationPercentage(value[0])}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              {allocationPercentage}% of their time = ~{Math.round((40 * allocationPercentage) / 100)} hours per week
            </p>
          </div>
          
          {/* Add Button */}
          <Button
            type="button"
            onClick={handleAddResource}
            disabled={!selectedUserId || !selectedRole}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add to Team
          </Button>
        </CardContent>
      </Card>
      
      {/* Warning for over-allocations */}
      {overallocatedUsers.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
                  Over-allocation Warning
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  The following team members are allocated over 100%:
                </p>
                <ul className="mt-2 space-y-1">
                  {overallocatedUsers.map((user) => (
                    <li key={user.name} className="text-sm text-amber-800 dark:text-amber-200">
                      • {user.name} ({user.total}%)
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Team Summary */}
      <Card className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Team Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Team Members</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {totalTeamMembers}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Avg Allocation</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {avgAllocation}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Total Weekly Hours</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {Math.round(totalWeeklyHours)}h
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Resource Allocations Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team Allocations ({resourceAllocations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {resourceAllocations.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed rounded-lg">
              <Users className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No team members added yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add team members using the form above
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {resourceAllocations.map((allocation) => {
                const userTotalAllocation = userAllocations.get(allocation.userId) || 0;
                const isOverallocated = userTotalAllocation > 100;
                
                return (
                  <div
                    key={allocation.id}
                    className={cn(
                      'p-4 rounded-lg border-2 transition-colors',
                      isOverallocated && 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20',
                      !isOverallocated && 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900'
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{allocation.userName}</p>
                            <p className="text-sm text-muted-foreground">{allocation.role}</p>
                          </div>
                          <Badge
                            variant={isOverallocated ? 'destructive' : 'outline'}
                            className="shrink-0"
                          >
                            {allocation.allocationPercentage}%
                          </Badge>
                        </div>
                        
                        <Slider
                          value={[allocation.allocationPercentage]}
                          onValueChange={(value) => handleUpdateAllocation(allocation.id, value[0])}
                          max={150}
                          step={5}
                        />
                        
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {Math.round((allocation.normalizedHours || 40) * (allocation.allocationPercentage / 100))}h/week on this plan
                          </span>
                          <span>${allocation.hourlyRate}/hr</span>
                        </div>
                      </div>
                      
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => handleRemoveResource(allocation.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
