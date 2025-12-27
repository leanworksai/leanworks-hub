/**
 * Journey Tracker Utilities
 * Calculates user journey stages based on activity and account age
 */

export type JourneyStage = 'onboarding' | 'active' | 'power_user';

interface UserActivity {
  signupDate: Date | string | null;
  firstProjectCreated: boolean;
  firstTaskCreated: boolean;
  firstAIChat: boolean;
  firstVoiceCall: boolean;
  projectsCount: number;
  tasksCount: number;
  daysSinceSignup: number;
}

/**
 * Calculate journey stage based on user activity
 */
export function calculateJourneyStage(activity: UserActivity): JourneyStage {
  const {
    signupDate,
    firstProjectCreated,
    firstTaskCreated,
    firstAIChat,
    firstVoiceCall,
    projectsCount,
    tasksCount,
    daysSinceSignup,
  } = activity;

  // Power user criteria
  const isPowerUser =
    daysSinceSignup >= 7 &&
    (projectsCount >= 3 || tasksCount >= 10) &&
    (firstAIChat || firstVoiceCall);

  // Active user criteria
  const isActive =
    daysSinceSignup >= 1 &&
    (firstProjectCreated || firstTaskCreated);

  // Determine stage
  if (isPowerUser) {
    return 'power_user';
  } else if (isActive) {
    return 'active';
  } else {
    return 'onboarding';
  }
}

/**
 * Calculate days since signup
 */
export function calculateDaysSinceSignup(signupDate: Date | string | null): number {
  if (!signupDate) {
    return 0;
  }

  const signup = typeof signupDate === 'string' ? new Date(signupDate) : signupDate;
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - signup.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Check if user has completed onboarding milestones
 */
export function getOnboardingProgress(activity: UserActivity): {
  completed: boolean;
  milestones: {
    emailVerified: boolean;
    firstProject: boolean;
    firstTask: boolean;
    firstAIChat: boolean;
  };
} {
  return {
    completed: activity.firstProjectCreated && activity.firstTaskCreated,
    milestones: {
      emailVerified: activity.daysSinceSignup >= 0, // Assume verified if account exists
      firstProject: activity.firstProjectCreated,
      firstTask: activity.firstTaskCreated,
      firstAIChat: activity.firstAIChat,
    },
  };
}

