// Plan Calculations - Health scoring, budget, and resource utilities

import type { Plan, ResourceAllocation } from '@/data/plansData';

export interface HealthScoreBreakdown {
  overall: number;
  timeline: number;
  budget: number;
  resources: number;
  objectives: number;
}

export interface BudgetUtilization {
  percentage: number;
  spent: number;
  total: number;
  remaining: number;
  status: 'healthy' | 'warning' | 'critical';
}

export interface ResourceOverallocation {
  userId: string;
  userEmail: string;
  userName: string;
  totalAllocation: number;
  allocations: ResourceAllocation[];
}

export interface BurnRate {
  dailyRate: number;
  projectedTotal: number;
  daysRemaining: number;
  onTrack: boolean;
}

/**
 * Calculate plan health score based on multiple factors
 * Returns score from 0-100
 */
export const calculateHealthScore = (
  plan: Plan,
  projects?: any[],
  tasks?: any[]
): HealthScoreBreakdown => {
  // Timeline score (30% weight)
  const timelineScore = calculateTimelineScore(plan);
  
  // Budget score (25% weight)
  const budgetScore = calculateBudgetScore(plan);
  
  // Resource score (20% weight)
  const resourceScore = calculateResourceScore(plan);
  
  // Objectives score (25% weight)
  const objectivesScore = calculateObjectivesScore(plan);
  
  const overall = Math.round(
    timelineScore * 0.3 +
    budgetScore * 0.25 +
    resourceScore * 0.2 +
    objectivesScore * 0.25
  );
  
  return {
    overall,
    timeline: timelineScore,
    budget: budgetScore,
    resources: resourceScore,
    objectives: objectivesScore,
  };
};

/**
 * Calculate timeline score based on plan progress
 */
const calculateTimelineScore = (plan: Plan): number => {
  const now = new Date();
  const start = new Date(plan.startDate);
  const end = new Date(plan.endDate);
  
  const totalDuration = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  const percentElapsed = (elapsed / totalDuration) * 100;
  
  // Calculate objectives completion percentage
  const completedObjectives = plan.objectives.filter(obj => obj.status === 'completed').length;
  const totalObjectives = plan.objectives.length;
  const objectivesProgress = totalObjectives > 0 ? (completedObjectives / totalObjectives) * 100 : 0;
  
  // Compare progress to time elapsed
  // If progress >= time elapsed, score 100
  // If progress < time elapsed, score decreases proportionally
  if (objectivesProgress >= percentElapsed) {
    return 100;
  } else {
    // Calculate how far behind we are
    const gap = percentElapsed - objectivesProgress;
    return Math.max(0, 100 - gap);
  }
};

/**
 * Calculate budget score
 */
const calculateBudgetScore = (plan: Plan): number => {
  const utilization = calculateBudgetUtilization(plan.spentToDate, plan.totalBudget);
  
  // Get time progress
  const now = new Date();
  const start = new Date(plan.startDate);
  const end = new Date(plan.endDate);
  const totalDuration = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  const percentElapsed = Math.min(100, (elapsed / totalDuration) * 100);
  
  const budgetSpentPercent = utilization.percentage;
  
  // Ideal: budget spent = time elapsed
  // Good: budget spent < time elapsed (under budget)
  // Bad: budget spent > time elapsed (over budget)
  
  if (budgetSpentPercent <= percentElapsed) {
    // Under or on budget - excellent
    return 100;
  } else {
    // Over budget - score decreases
    const overSpend = budgetSpentPercent - percentElapsed;
    return Math.max(0, 100 - (overSpend * 2));
  }
};

/**
 * Calculate resource allocation score
 */
const calculateResourceScore = (plan: Plan): number => {
  const overallocations = detectResourceOverallocation(plan.resourceAllocations);
  
  if (overallocations.length === 0) {
    return 100;
  }
  
  // Penalize for each overallocated resource
  // Severe penalty for >120% allocation
  let penalty = 0;
  overallocations.forEach(overalloc => {
    const excess = overalloc.totalAllocation - 100;
    if (excess > 20) {
      penalty += 30; // Severe overallocation
    } else if (excess > 10) {
      penalty += 20;
    } else {
      penalty += 10;
    }
  });
  
  return Math.max(0, 100 - penalty);
};

/**
 * Calculate objectives score
 */
const calculateObjectivesScore = (plan: Plan): number => {
  if (plan.objectives.length === 0) return 100;
  
  let totalScore = 0;
  plan.objectives.forEach(obj => {
    const progress = (obj.currentValue / obj.targetValue) * 100;
    
    // Check if objective is at risk
    if (obj.status === 'at-risk') {
      totalScore += Math.min(progress * 0.7, 70); // Cap at 70 for at-risk
    } else if (obj.status === 'completed') {
      totalScore += 100;
    } else {
      totalScore += Math.min(progress, 100);
    }
  });
  
  return Math.round(totalScore / plan.objectives.length);
};

/**
 * Calculate normalized work hours for a user based on historical data
 * Uses weighted scoring: 60% task completion, 40% update frequency
 */
export const calculateNormalizedWorkHours = (
  userId: string,
  historicalData: {
    tasksCompletedPerWeek: number;
    progressUpdatesPerWeek: number;
  }
): number => {
  const { tasksCompletedPerWeek, progressUpdatesPerWeek } = historicalData;
  
  // Normalize to a 40-hour work week
  // Assume average task = 8 hours, average update = 0.5 hours
  const taskHours = tasksCompletedPerWeek * 8;
  const updateHours = progressUpdatesPerWeek * 0.5;
  
  // Apply weights
  const weightedHours = (taskHours * 0.6) + (updateHours * 0.4);
  
  // Cap at 40 hours (reasonable max)
  return Math.min(40, Math.round(weightedHours));
};

/**
 * Calculate budget utilization metrics
 */
export const calculateBudgetUtilization = (
  spent: number,
  total: number
): BudgetUtilization => {
  const percentage = total > 0 ? (spent / total) * 100 : 0;
  const remaining = total - spent;
  
  let status: 'healthy' | 'warning' | 'critical';
  if (percentage < 75) {
    status = 'healthy';
  } else if (percentage < 90) {
    status = 'warning';
  } else {
    status = 'critical';
  }
  
  return {
    percentage: Math.round(percentage * 10) / 10, // Round to 1 decimal
    spent,
    total,
    remaining,
    status,
  };
};

/**
 * Detect resources with >100% allocation
 */
export const detectResourceOverallocation = (
  allocations: ResourceAllocation[]
): ResourceOverallocation[] => {
  // Group allocations by user
  const userAllocations = new Map<string, ResourceAllocation[]>();
  
  allocations.forEach(alloc => {
    const existing = userAllocations.get(alloc.userId) || [];
    existing.push(alloc);
    userAllocations.set(alloc.userId, existing);
  });
  
  // Check for overlapping date ranges
  const overallocations: ResourceOverallocation[] = [];
  
  userAllocations.forEach((userAllocs, userId) => {
    // For simplicity, sum all allocations (assumes they overlap)
    // In a real system, you'd check for actual date overlaps
    const totalAllocation = userAllocs.reduce((sum, alloc) => sum + alloc.allocationPercentage, 0);
    
    if (totalAllocation > 100) {
      overallocations.push({
        userId,
        userEmail: userAllocs[0].userEmail,
        userName: userAllocs[0].userName,
        totalAllocation,
        allocations: userAllocs,
      });
    }
  });
  
  return overallocations;
};

/**
 * Calculate budget burn rate
 */
export const calculateBurnRate = (
  spent: number,
  startDate: string,
  endDate: string,
  totalBudget: number
): BurnRate => {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);
  
  const dailyRate = spent / daysElapsed;
  const projectedTotal = dailyRate * totalDays;
  const onTrack = projectedTotal <= totalBudget;
  
  return {
    dailyRate: Math.round(dailyRate * 100) / 100,
    projectedTotal: Math.round(projectedTotal),
    daysRemaining,
    onTrack,
  };
};

/**
 * Calculate health trend based on historical health scores
 */
export const calculateHealthTrend = (
  currentScore: number,
  previousScore?: number
): 'up' | 'down' | 'stable' => {
  if (!previousScore) return 'stable';
  
  const diff = currentScore - previousScore;
  if (diff > 5) return 'up';
  if (diff < -5) return 'down';
  return 'stable';
};

/**
 * Get health score color based on value
 */
export const getHealthScoreColor = (score: number): string => {
  if (score >= 71) return 'text-green-600';
  if (score >= 41) return 'text-yellow-600';
  return 'text-red-600';
};

/**
 * Get health score background color based on value
 */
export const getHealthScoreBgColor = (score: number): string => {
  if (score >= 71) return 'bg-green-100';
  if (score >= 41) return 'bg-yellow-100';
  return 'bg-red-100';
};

/**
 * Get budget status color
 */
export const getBudgetStatusColor = (status: BudgetUtilization['status']): string => {
  switch (status) {
    case 'healthy': return 'text-green-600';
    case 'warning': return 'text-yellow-600';
    case 'critical': return 'text-red-600';
  }
};
