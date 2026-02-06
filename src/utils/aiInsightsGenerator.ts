// AI Insights Generator - Generate mock AI recommendations and insights for plans

import type { Plan } from '@/data/plansData';
import { calculateBudgetUtilization, calculateBurnRate, detectResourceOverallocation } from './planCalculations';

export interface AIInsight {
  id: string;
  type: 'summary' | 'risk' | 'recommendation' | 'prediction';
  severity?: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  actionable?: boolean;
}

/**
 * Generate AI insights for a plan
 */
export const generatePlanInsights = (plan: Plan): AIInsight[] => {
  const insights: AIInsight[] = [];
  
  // Generate summary
  insights.push(generateSummary(plan));
  
  // Detect risks
  insights.push(...detectRisks(plan));
  
  // Generate recommendations
  insights.push(...generateRecommendations(plan));
  
  // Add predictions
  insights.push(...generatePredictions(plan));
  
  return insights;
};

/**
 * Generate plan status summary
 */
const generateSummary = (plan: Plan): AIInsight => {
  const completedObjectives = plan.objectives.filter(obj => obj.status === 'completed').length;
  const totalObjectives = plan.objectives.length;
  const atRiskObjectives = plan.objectives.filter(obj => obj.status === 'at-risk').length;
  
  const budgetUtil = calculateBudgetUtilization(plan.spentToDate, plan.totalBudget);
  
  let summaryText = '';
  
  if (plan.status === 'active') {
    summaryText = `${plan.name} is currently active with a health score of ${plan.healthScore}/100. `;
    summaryText += `Progress: ${completedObjectives}/${totalObjectives} objectives completed. `;
    
    if (atRiskObjectives > 0) {
      summaryText += `${atRiskObjectives} objective${atRiskObjectives > 1 ? 's are' : ' is'} at risk. `;
    }
    
    summaryText += `Budget: ${budgetUtil.percentage.toFixed(0)}% utilized ($${(plan.spentToDate / 1000).toFixed(0)}K of $${(plan.totalBudget / 1000).toFixed(0)}K). `;
    
    if (plan.healthScore >= 70) {
      summaryText += 'Overall trajectory is positive.';
    } else if (plan.healthScore >= 50) {
      summaryText += 'Some areas need attention to stay on track.';
    } else {
      summaryText += 'Significant challenges require immediate action.';
    }
  } else if (plan.status === 'planning') {
    summaryText = `${plan.name} is in planning phase. Team size: ${plan.teamSize} members. Budget allocated: $${(plan.totalBudget / 1000).toFixed(0)}K. Ready to commence execution.`;
  } else if (plan.status === 'at-risk') {
    summaryText = `${plan.name} is flagged at-risk with health score ${plan.healthScore}/100. Critical attention needed on timeline, budget, or resource constraints.`;
  } else {
    summaryText = `${plan.name} has been completed. Final metrics available for review.`;
  }
  
  return {
    id: 'summary-1',
    type: 'summary',
    title: 'Plan Status Overview',
    description: summaryText,
  };
};

/**
 * Detect plan risks
 */
const detectRisks = (plan: Plan): AIInsight[] => {
  const risks: AIInsight[] = [];
  
  // Budget risk
  const budgetUtil = calculateBudgetUtilization(plan.spentToDate, plan.totalBudget);
  const burnRate = calculateBurnRate(plan.spentToDate, plan.startDate, plan.endDate, plan.totalBudget);
  
  if (!burnRate.onTrack) {
    const overage = burnRate.projectedTotal - plan.totalBudget;
    risks.push({
      id: 'risk-budget',
      type: 'risk',
      severity: overage > plan.totalBudget * 0.2 ? 'high' : 'medium',
      title: 'Budget Overrun Projected',
      description: `At current burn rate of $${burnRate.dailyRate.toFixed(0)}/day, plan will exceed budget by $${(overage / 1000).toFixed(0)}K. Consider budget reallocation or scope adjustment.`,
      actionable: true,
    });
  } else if (budgetUtil.status === 'warning' || budgetUtil.status === 'critical') {
    risks.push({
      id: 'risk-budget-warning',
      type: 'risk',
      severity: 'medium',
      title: 'High Budget Utilization',
      description: `Budget is ${budgetUtil.percentage.toFixed(0)}% utilized with ${burnRate.daysRemaining} days remaining. Monitor spending closely.`,
      actionable: true,
    });
  }
  
  // Resource overallocation risk
  const overallocations = detectResourceOverallocation(plan.resourceAllocations);
  if (overallocations.length > 0) {
    overallocations.forEach((overalloc, index) => {
      const severity: 'low' | 'medium' | 'high' = 
        overalloc.totalAllocation > 120 ? 'high' :
        overalloc.totalAllocation > 110 ? 'medium' : 'low';
      
      risks.push({
        id: `risk-resource-${index}`,
        type: 'risk',
        severity,
        title: 'Resource Overallocation Detected',
        description: `${overalloc.userName} is allocated at ${overalloc.totalAllocation}% capacity. Risk of burnout and missed deadlines. Recommend rebalancing or adding support.`,
        actionable: true,
      });
    });
  }
  
  // Timeline risk - at-risk objectives
  const atRiskObjectives = plan.objectives.filter(obj => obj.status === 'at-risk');
  if (atRiskObjectives.length > 0) {
    const objectiveNames = atRiskObjectives.map(obj => obj.text).join(', ');
    risks.push({
      id: 'risk-objectives',
      type: 'risk',
      severity: atRiskObjectives.length > 1 ? 'high' : 'medium',
      title: 'Objectives At Risk',
      description: `${atRiskObjectives.length} objective${atRiskObjectives.length > 1 ? 's are' : ' is'} flagged at-risk: ${objectiveNames}. May impact plan success.`,
      actionable: true,
    });
  }
  
  // Milestone risk - check for upcoming at-risk milestones
  const upcomingAtRiskMilestones = plan.milestones.filter(m => {
    if (m.status !== 'at-risk') return false;
    const dueDate = new Date(m.dueDate);
    const now = new Date();
    const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil <= 30 && daysUntil > 0;
  });
  
  if (upcomingAtRiskMilestones.length > 0) {
    upcomingAtRiskMilestones.forEach((milestone, index) => {
      risks.push({
        id: `risk-milestone-${index}`,
        type: 'risk',
        severity: 'high',
        title: 'Critical Milestone At Risk',
        description: `Milestone "${milestone.name}" due ${milestone.dueDate} is at risk. Immediate intervention required to prevent delay.`,
        actionable: true,
      });
    });
  }
  
  return risks;
};

/**
 * Generate recommendations
 */
const generateRecommendations = (plan: Plan): AIInsight[] => {
  const recommendations: AIInsight[] = [];
  
  // Recommendation based on health score
  if (plan.healthScore < 50) {
    recommendations.push({
      id: 'rec-health',
      type: 'recommendation',
      title: 'Schedule Plan Review',
      description: 'Health score below 50 indicates systemic issues. Recommend immediate stakeholder review to assess timeline, budget, and resource adjustments.',
      actionable: true,
    });
  }
  
  // Resource recommendations
  const overallocations = detectResourceOverallocation(plan.resourceAllocations);
  if (overallocations.length > 0) {
    recommendations.push({
      id: 'rec-resources',
      type: 'recommendation',
      title: 'Rebalance Resource Allocation',
      description: `${overallocations.length} team member${overallocations.length > 1 ? 's are' : ' is'} overallocated. Consider: 1) Extend timeline, 2) Add contractors, or 3) Reduce scope.`,
      actionable: true,
    });
  } else {
    // Check for underutilization
    const underutilized = plan.resourceAllocations.filter(r => r.allocationPercentage < 50);
    if (underutilized.length > 2) {
      recommendations.push({
        id: 'rec-underutilized',
        type: 'recommendation',
        title: 'Optimize Resource Usage',
        description: `${underutilized.length} resources allocated below 50%. Consider reallocating to accelerate at-risk objectives or reduce costs.`,
        actionable: true,
      });
    }
  }
  
  // Budget recommendations
  const budgetUtil = calculateBudgetUtilization(plan.spentToDate, plan.totalBudget);
  const burnRate = calculateBurnRate(plan.spentToDate, plan.startDate, plan.endDate, plan.totalBudget);
  
  if (!burnRate.onTrack) {
    recommendations.push({
      id: 'rec-budget',
      type: 'recommendation',
      title: 'Adjust Budget or Scope',
      description: `Current burn rate will exceed budget. Options: 1) Request additional $${((burnRate.projectedTotal - plan.totalBudget) / 1000).toFixed(0)}K, 2) Reduce scope, or 3) Extend timeline to spread costs.`,
      actionable: true,
    });
  }
  
  // Objective-based recommendations
  const behindScheduleObjectives = plan.objectives.filter(obj => {
    const progress = (obj.currentValue / obj.targetValue) * 100;
    return progress < 50 && obj.status !== 'completed';
  });
  
  if (behindScheduleObjectives.length > 0) {
    recommendations.push({
      id: 'rec-objectives',
      type: 'recommendation',
      title: 'Accelerate Objective Progress',
      description: `${behindScheduleObjectives.length} objective${behindScheduleObjectives.length > 1 ? 's are' : ' is'} progressing slowly. Recommend focused sprint or additional resources to prevent cascading delays.`,
      actionable: true,
    });
  }
  
  // Positive recommendations for healthy plans
  if (plan.healthScore >= 80) {
    recommendations.push({
      id: 'rec-positive',
      type: 'recommendation',
      title: 'Plan Performing Well',
      description: 'All metrics trending positively. Maintain current velocity and resource allocation. Consider documenting success patterns for future plans.',
      actionable: false,
    });
  }
  
  return recommendations;
};

/**
 * Generate predictive insights
 */
const generatePredictions = (plan: Plan): AIInsight[] => {
  const predictions: AIInsight[] = [];
  
  // Completion date prediction
  const now = new Date();
  const end = new Date(plan.endDate);
  const start = new Date(plan.startDate);
  
  const totalDuration = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  const percentElapsed = (elapsed / totalDuration) * 100;
  
  const completedObjectives = plan.objectives.filter(obj => obj.status === 'completed').length;
  const totalObjectives = plan.objectives.length;
  const percentComplete = (completedObjectives / totalObjectives) * 100;
  
  if (percentComplete < percentElapsed - 15) {
    // Behind schedule
    const delay = Math.round((percentElapsed - percentComplete) / 100 * totalDuration / (1000 * 60 * 60 * 24));
    predictions.push({
      id: 'pred-timeline',
      type: 'prediction',
      title: 'Timeline Delay Expected',
      description: `Based on current velocity, plan completion may be delayed by approximately ${delay} days. Recommend adjusting timeline or accelerating progress.`,
      actionable: true,
    });
  } else if (percentComplete > percentElapsed + 15) {
    // Ahead of schedule
    predictions.push({
      id: 'pred-timeline-early',
      type: 'prediction',
      title: 'Early Completion Likely',
      description: 'Current progress exceeds schedule. Consider advancing timeline or expanding scope to capitalize on momentum.',
      actionable: true,
    });
  }
  
  // Budget prediction
  const burnRate = calculateBurnRate(plan.spentToDate, plan.startDate, plan.endDate, plan.totalBudget);
  if (burnRate.projectedTotal > plan.totalBudget * 1.1) {
    predictions.push({
      id: 'pred-budget',
      type: 'prediction',
      title: 'Budget Shortfall Forecast',
      description: `Projected to need additional $${((burnRate.projectedTotal - plan.totalBudget) / 1000).toFixed(0)}K to complete plan. Recommend budget review within 2 weeks.`,
      actionable: true,
    });
  }
  
  return predictions;
};

/**
 * Generate a quick one-liner insight for list view
 */
export const generateQuickInsight = (plan: Plan): string => {
  const insights = generatePlanInsights(plan);
  
  // Find the most critical insight
  const criticalRisk = insights.find(i => i.type === 'risk' && i.severity === 'high');
  if (criticalRisk) {
    return criticalRisk.description;
  }
  
  const mediumRisk = insights.find(i => i.type === 'risk' && i.severity === 'medium');
  if (mediumRisk) {
    return mediumRisk.description;
  }
  
  const recommendation = insights.find(i => i.type === 'recommendation' && i.actionable);
  if (recommendation) {
    return recommendation.description;
  }
  
  // Default positive message
  if (plan.healthScore >= 70) {
    return `Plan is on track. ${plan.objectives.filter(o => o.status === 'completed').length}/${plan.objectives.length} objectives completed.`;
  }
  
  return 'Monitoring plan progress. Review recommended.';
};
