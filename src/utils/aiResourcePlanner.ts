// AI Resource Planner - Generate optimized resource allocation strategies

import type { ResourceAllocation } from '@/data/plansData';
import { mockUserPerformanceData, type UserPerformanceData } from '@/data/userPerformanceData';

export interface AIResourcePlan {
  strategy: 'cost' | 'time' | 'quality';
  strategyName: string;
  totalCost: number;
  estimatedDuration: number; // in months
  teamSize: number;
  riskLevel: 'low' | 'medium' | 'high';
  allocations: ResourceAllocation[];
  analysis: {
    rationale: string;
    tradeoffs: string[];
    expectedOutcomes: string[];
    keyAssumptions: string[];
  };
  metrics: {
    avgAllocationPercentage: number;
    seniorityMix: { senior: number; mid: number; junior: number };
    utilizationRate: number;
    totalWeeklyHours: number;
  };
}

interface PlanContext {
  totalBudget: number;
  startDate: string;
  endDate: string;
  projectIds: string[];
  objectives: any[];
}

/**
 * Main function: Generate 3 resource allocation strategies
 */
export const generateResourcePlans = (context: PlanContext): AIResourcePlan[] => {
  const availableUsers = mockUserPerformanceData.filter(u => u.availability > 0);
  
  return [
    generateCostOptimizedPlan(context, availableUsers),
    generateTimeOptimizedPlan(context, availableUsers),
    generateQualityOptimizedPlan(context, availableUsers),
  ];
};

/**
 * Cost-Optimized Strategy
 * Minimize cost using junior/mid resources with moderate allocations
 */
const generateCostOptimizedPlan = (
  context: PlanContext,
  availableUsers: UserPerformanceData[]
): AIResourcePlan => {
  // Prioritize by: low hourly rate, good efficiency, availability
  const sorted = [...availableUsers].sort((a, b) => {
    const scoreA = (100 - a.hourlyRate) + a.costEfficiency + a.availability;
    const scoreB = (100 - b.hourlyRate) + b.costEfficiency + b.availability;
    return scoreB - scoreA;
  });
  
  // Select 5-7 team members with lower rates
  const teamSize = Math.min(6, sorted.length);
  const selectedUsers = sorted.slice(0, teamSize);
  
  const allocations: ResourceAllocation[] = selectedUsers.map((user, index) => {
    // Lower allocations (50-70%) to reduce cost
    const allocation = 50 + (index * 3) + (user.availability > 50 ? 10 : 0);
    
    return {
      id: `alloc-cost-${user.userId}`,
      userId: user.userId,
      userEmail: user.userEmail,
      userName: user.userName,
      planId: '',
      allocationPercentage: Math.min(70, allocation),
      startDate: context.startDate,
      endDate: context.endDate,
      role: getRecommendedRole(user),
      hourlyRate: user.hourlyRate,
      normalizedHours: user.normalizedHours,
    };
  });
  
  const totalCost = calculateTotalCost(allocations, context.startDate, context.endDate);
  const estimatedDuration = 6; // Longer duration due to lower allocations
  
  return {
    strategy: 'cost',
    strategyName: 'Cost-Optimized',
    totalCost,
    estimatedDuration,
    teamSize: allocations.length,
    riskLevel: 'medium',
    allocations,
    analysis: {
      rationale: 'This strategy minimizes costs by utilizing mid-level and junior engineers with moderate allocation percentages (50-70%). The extended timeline of 6 months allows for sustainable pacing while keeping budget low.',
      tradeoffs: [
        'Longer delivery timeline (6 months)',
        'Less experienced team mix may require more oversight',
        'Lower allocation percentages mean parallel work on other initiatives',
      ],
      expectedOutcomes: [
        'Significant cost savings (~40% vs time-optimized)',
        'Sustainable team workload with low burnout risk',
        'Opportunity for junior team members to grow skills',
      ],
      keyAssumptions: [
        'Team has sufficient capacity for moderate allocations',
        'Timeline flexibility allows for extended delivery',
        'Mid-level engineers can handle core requirements',
      ],
    },
    metrics: {
      avgAllocationPercentage: Math.round(allocations.reduce((sum, a) => sum + a.allocationPercentage, 0) / allocations.length),
      seniorityMix: calculateSeniorityMix(selectedUsers),
      utilizationRate: 65,
      totalWeeklyHours: Math.round(allocations.reduce((sum, a) => sum + (a.normalizedHours || 0) * (a.allocationPercentage / 100), 0)),
    },
  };
};

/**
 * Time-Optimized Strategy
 * Minimize duration using senior resources with high allocations
 */
const generateTimeOptimizedPlan = (
  context: PlanContext,
  availableUsers: UserPerformanceData[]
): AIResourcePlan => {
  // Prioritize by: reliability, normalized hours, seniority
  const sorted = [...availableUsers].sort((a, b) => {
    const scoreA = a.reliability + (a.normalizedHours * 2) + (a.seniorityLevel === 'senior' ? 50 : a.seniorityLevel === 'mid' ? 25 : 0);
    const scoreB = b.reliability + (b.normalizedHours * 2) + (b.seniorityLevel === 'senior' ? 50 : b.seniorityLevel === 'mid' ? 25 : 0);
    return scoreB - scoreA;
  });
  
  // Select 8-10 experienced team members
  const teamSize = Math.min(9, sorted.length);
  const selectedUsers = sorted.slice(0, teamSize);
  
  const allocations: ResourceAllocation[] = selectedUsers.map((user, index) => {
    // High allocations (80-100%) for fast delivery
    const allocation = 80 + (user.seniorityLevel === 'senior' ? 15 : 10);
    
    return {
      id: `alloc-time-${user.userId}`,
      userId: user.userId,
      userEmail: user.userEmail,
      userName: user.userName,
      planId: '',
      allocationPercentage: Math.min(100, Math.min(allocation, user.availability + 30)), // Can go slightly over if needed
      startDate: context.startDate,
      endDate: context.endDate,
      role: getRecommendedRole(user),
      hourlyRate: user.hourlyRate,
      normalizedHours: user.normalizedHours,
    };
  });
  
  const totalCost = calculateTotalCost(allocations, context.startDate, context.endDate);
  const estimatedDuration = 3; // Shortest duration
  
  return {
    strategy: 'time',
    strategyName: 'Time-Optimized',
    totalCost,
    estimatedDuration,
    teamSize: allocations.length,
    riskLevel: 'high',
    allocations,
    analysis: {
      rationale: 'This aggressive strategy prioritizes speed by assembling a larger team of senior engineers with high allocation percentages (80-100%). Compresses timeline to 3 months through intensive focus.',
      tradeoffs: [
        'Significantly higher cost (~50% premium)',
        'High team allocation increases burnout risk',
        'May pull resources from other initiatives',
      ],
      expectedOutcomes: [
        'Fastest time-to-market (3 months)',
        'Highest quality deliverables from experienced team',
        'Reduced overall project risk through expertise',
      ],
      keyAssumptions: [
        'Budget flexibility exists for higher costs',
        'Speed-to-market provides competitive advantage',
        'Team can sustain high allocation temporarily',
      ],
    },
    metrics: {
      avgAllocationPercentage: Math.round(allocations.reduce((sum, a) => sum + a.allocationPercentage, 0) / allocations.length),
      seniorityMix: calculateSeniorityMix(selectedUsers),
      utilizationRate: 92,
      totalWeeklyHours: Math.round(allocations.reduce((sum, a) => sum + (a.normalizedHours || 0) * (a.allocationPercentage / 100), 0)),
    },
  };
};

/**
 * Quality-Optimized Strategy
 * Balance cost, time, and quality with sustainable allocations
 */
const generateQualityOptimizedPlan = (
  context: PlanContext,
  availableUsers: UserPerformanceData[]
): AIResourcePlan => {
  // Prioritize by: balanced skills, reliability, availability
  const sorted = [...availableUsers].sort((a, b) => {
    const scoreA = a.reliability + a.costEfficiency + (a.availability * 0.5);
    const scoreB = b.reliability + b.costEfficiency + (b.availability * 0.5);
    return scoreB - scoreA;
  });
  
  // Select 7-9 well-rounded team members
  const teamSize = Math.min(8, sorted.length);
  const selectedUsers = sorted.slice(0, teamSize);
  
  // Ensure good mix of seniority
  const seniors = selectedUsers.filter(u => u.seniorityLevel === 'senior');
  const mids = selectedUsers.filter(u => u.seniorityLevel === 'mid');
  const juniors = selectedUsers.filter(u => u.seniorityLevel === 'junior');
  
  const allocations: ResourceAllocation[] = selectedUsers.map((user, index) => {
    // Comfortable allocations (60-80%)
    let allocation = 70;
    if (user.seniorityLevel === 'senior') allocation = 75;
    if (user.seniorityLevel === 'junior') allocation = 60;
    
    return {
      id: `alloc-quality-${user.userId}`,
      userId: user.userId,
      userEmail: user.userEmail,
      userName: user.userName,
      planId: '',
      allocationPercentage: Math.min(allocation, user.availability + 10),
      startDate: context.startDate,
      endDate: context.endDate,
      role: getRecommendedRole(user),
      hourlyRate: user.hourlyRate,
      normalizedHours: user.normalizedHours,
    };
  });
  
  const totalCost = calculateTotalCost(allocations, context.startDate, context.endDate);
  const estimatedDuration = 4; // Moderate duration
  
  return {
    strategy: 'quality',
    strategyName: 'Quality-Focused',
    totalCost,
    estimatedDuration,
    teamSize: allocations.length,
    riskLevel: 'low',
    allocations,
    analysis: {
      rationale: 'This balanced strategy optimizes for sustainable quality by mixing senior and mid-level talent at comfortable allocation levels (60-80%). Delivers in 4 months with minimal risk.',
      tradeoffs: [
        'Moderate cost and timeline (middle ground)',
        'Requires coordination across larger team',
        'May not be fastest option for urgent launches',
      ],
      expectedOutcomes: [
        'High-quality deliverables with thorough review',
        'Sustainable pace minimizes technical debt',
        'Strong team morale and low turnover risk',
      ],
      keyAssumptions: [
        'Quality and sustainability are priorities',
        '4-month timeline is acceptable',
        'Team has capacity for moderate allocations',
      ],
    },
    metrics: {
      avgAllocationPercentage: Math.round(allocations.reduce((sum, a) => sum + a.allocationPercentage, 0) / allocations.length),
      seniorityMix: calculateSeniorityMix(selectedUsers),
      utilizationRate: 75,
      totalWeeklyHours: Math.round(allocations.reduce((sum, a) => sum + (a.normalizedHours || 0) * (a.allocationPercentage / 100), 0)),
    },
  };
};

/**
 * Calculate total cost for allocations
 */
const calculateTotalCost = (
  allocations: ResourceAllocation[],
  startDate: string,
  endDate: string
): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const weeks = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7));
  
  return allocations.reduce((total, alloc) => {
    const weeklyHours = (alloc.normalizedHours || 40) * (alloc.allocationPercentage / 100);
    const weeklyCost = weeklyHours * (alloc.hourlyRate || 75);
    return total + (weeklyCost * weeks);
  }, 0);
};

/**
 * Calculate seniority mix
 */
const calculateSeniorityMix = (users: UserPerformanceData[]): { senior: number; mid: number; junior: number } => {
  const total = users.length;
  if (total === 0) return { senior: 0, mid: 0, junior: 0 };
  
  const senior = users.filter(u => u.seniorityLevel === 'senior').length;
  const mid = users.filter(u => u.seniorityLevel === 'mid').length;
  const junior = users.filter(u => u.seniorityLevel === 'junior').length;
  
  return {
    senior: Math.round((senior / total) * 100),
    mid: Math.round((mid / total) * 100),
    junior: Math.round((junior / total) * 100),
  };
};

/**
 * Get recommended role based on user skills
 */
const getRecommendedRole = (user: UserPerformanceData): string => {
  const skills = user.skills;
  
  // Pattern matching for roles
  if (skills.some(s => s.toLowerCase().includes('lead') || s.toLowerCase().includes('architect'))) {
    return 'Tech Lead';
  }
  if (skills.some(s => ['react', 'vue', 'angular', 'frontend'].some(term => s.toLowerCase().includes(term)))) {
    return 'Frontend Engineer';
  }
  if (skills.some(s => ['python', 'node', 'backend', 'api'].some(term => s.toLowerCase().includes(term)))) {
    return 'Backend Engineer';
  }
  if (skills.some(s => ['design', 'ui', 'ux'].some(term => s.toLowerCase().includes(term)))) {
    return 'Product Designer';
  }
  if (skills.some(s => ['qa', 'test', 'quality'].some(term => s.toLowerCase().includes(term)))) {
    return 'QA Engineer';
  }
  if (skills.some(s => ['devops', 'cloud', 'infrastructure'].some(term => s.toLowerCase().includes(term)))) {
    return 'DevOps Engineer';
  }
  if (skills.some(s => ['mobile', 'ios', 'android'].some(term => s.toLowerCase().includes(term)))) {
    return 'Mobile Engineer';
  }
  if (skills.some(s => ['data', 'analytics', 'sql'].some(term => s.toLowerCase().includes(term)))) {
    return 'Data Engineer';
  }
  
  return 'Engineer';
};

/**
 * Match users to specific roles needed
 */
export const matchUsersToRoles = (
  requiredRoles: string[],
  availableUsers: UserPerformanceData[]
): Map<string, UserPerformanceData[]> => {
  const matches = new Map<string, UserPerformanceData[]>();
  
  requiredRoles.forEach(role => {
    const roleLower = role.toLowerCase();
    const matched = availableUsers.filter(user => {
      const recommendedRole = getRecommendedRole(user).toLowerCase();
      return recommendedRole.includes(roleLower) || 
             user.skills.some(skill => skill.toLowerCase().includes(roleLower));
    });
    matches.set(role, matched);
  });
  
  return matches;
};

/**
 * Calculate plan metrics
 */
export const calculatePlanMetrics = (allocations: ResourceAllocation[]) => {
  if (allocations.length === 0) {
    return {
      totalCost: 0,
      avgAllocation: 0,
      totalWeeklyHours: 0,
      overallocatedCount: 0,
    };
  }
  
  const totalCost = allocations.reduce((sum, a) => {
    const weeklyHours = (a.normalizedHours || 40) * (a.allocationPercentage / 100);
    return sum + (weeklyHours * (a.hourlyRate || 75) * 4); // 4 weeks per month estimate
  }, 0);
  
  const avgAllocation = allocations.reduce((sum, a) => sum + a.allocationPercentage, 0) / allocations.length;
  
  const totalWeeklyHours = allocations.reduce((sum, a) => {
    return sum + ((a.normalizedHours || 40) * (a.allocationPercentage / 100));
  }, 0);
  
  const overallocatedCount = allocations.filter(a => a.allocationPercentage > 100).length;
  
  return {
    totalCost: Math.round(totalCost),
    avgAllocation: Math.round(avgAllocation),
    totalWeeklyHours: Math.round(totalWeeklyHours),
    overallocatedCount,
  };
};

/**
 * Generate AI reasoning for a specific user allocation
 */
export const generateUserAllocationReasoning = (
  user: UserPerformanceData,
  allocation: ResourceAllocation,
  strategy: 'cost' | 'time' | 'quality'
): string => {
  const reasons: string[] = [];
  
  // Performance-based reasoning
  if (user.reliability > 90) {
    reasons.push(`${user.userName} has an excellent track record with ${user.reliability}% reliability`);
  }
  
  // Skills-based reasoning
  if (user.skills.length > 4) {
    reasons.push(`brings diverse expertise in ${user.skills.slice(0, 3).join(', ')}`);
  }
  
  // Strategy-specific reasoning
  if (strategy === 'cost') {
    reasons.push(`cost-effective at $${user.hourlyRate}/hr with ${user.costEfficiency}% efficiency`);
  } else if (strategy === 'time') {
    reasons.push(`high velocity contributor averaging ${user.tasksCompletedPerWeek} tasks/week`);
  } else {
    reasons.push(`balanced allocation of ${allocation.allocationPercentage}% ensures sustainable quality`);
  }
  
  // Availability reasoning
  if (user.availability >= 50) {
    reasons.push(`has ${user.availability}% capacity available`);
  }
  
  return reasons.join('. ') + '.';
};

/**
 * Validate resource allocations
 */
export const validateAllocations = (allocations: ResourceAllocation[]): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} => {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Check for over-allocations
  const userAllocations = new Map<string, number>();
  allocations.forEach(alloc => {
    const current = userAllocations.get(alloc.userId) || 0;
    userAllocations.set(alloc.userId, current + alloc.allocationPercentage);
  });
  
  userAllocations.forEach((total, userId) => {
    if (total > 100) {
      const user = allocations.find(a => a.userId === userId);
      errors.push(`${user?.userName} is overallocated at ${total}%`);
    } else if (total > 90) {
      const user = allocations.find(a => a.userId === userId);
      warnings.push(`${user?.userName} is highly allocated at ${total}%`);
    }
  });
  
  // Check for skill coverage (basic check)
  const allSkills = new Set<string>();
  allocations.forEach(alloc => {
    const userData = mockUserPerformanceData.find(u => u.userId === alloc.userId);
    userData?.skills.forEach(skill => allSkills.add(skill.toLowerCase()));
  });
  
  if (!allSkills.has('frontend') && !Array.from(allSkills).some(s => s.includes('react') || s.includes('vue'))) {
    warnings.push('No frontend specialist assigned');
  }
  if (!allSkills.has('backend') && !Array.from(allSkills).some(s => s.includes('backend') || s.includes('api'))) {
    warnings.push('No backend specialist assigned');
  }
  
  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
};
