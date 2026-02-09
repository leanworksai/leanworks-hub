/**
 * Mock AI Service responses for demo mode
 */

export interface MockAIResponse {
  type: 'success' | 'processing' | 'thinking';
  content: string;
  metadata?: Record<string, any>;
}

export interface MockResourcePlan {
  role: string;
  allocation: number;
  estimatedHours: number;
  costPerHour: number;
  totalCost: number;
}

export interface MockInsight {
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  recommendation?: string;
}

// Simulated AI chat responses
const chatResponses = [
  "Based on the current project status, I recommend focusing on the critical path items first.",
  "We've made good progress this week. Keep up the momentum!",
  "Consider allocating more resources to the infrastructure work to meet the deadline.",
  "The AI features integration is on track. Quality looks good so far.",
  "I notice some potential bottlenecks in the microservices migration. Let me flag those.",
  "Your resource allocation is optimal for the current timeline.",
  "I suggest reviewing the design system refresh scope to avoid scope creep.",
  "The Platform Modernization project is a bit behind. We can catch up with focused sprints.",
  "Great work on the mobile app design mockups! Ready for development?",
  "Consider implementing the suggested performance optimizations to improve user experience.",
];

const taskSuggestions = [
  {
    title: "Code Review & Testing",
    description: "Ensure all features have proper unit and integration tests",
    priority: "high",
    estimatedHours: 16,
  },
  {
    title: "Security Audit",
    description: "Conduct security review of the authentication service",
    priority: "high",
    estimatedHours: 20,
  },
  {
    title: "Performance Optimization",
    description: "Profile and optimize database queries and API endpoints",
    priority: "medium",
    estimatedHours: 12,
  },
  {
    title: "Documentation Update",
    description: "Update API documentation with new endpoints",
    priority: "medium",
    estimatedHours: 8,
  },
  {
    title: "Accessibility Review",
    description: "Ensure UI components meet WCAG 2.1 AA standards",
    priority: "medium",
    estimatedHours: 10,
  },
];

const resourcePlans = [
  {
    role: "Senior Developer",
    allocation: 80,
    estimatedHours: 320,
    costPerHour: 95,
    totalCost: 30400,
  },
  {
    role: "UI/UX Designer",
    allocation: 60,
    estimatedHours: 240,
    costPerHour: 75,
    totalCost: 18000,
  },
  {
    role: "DevOps Engineer",
    allocation: 50,
    estimatedHours: 200,
    costPerHour: 90,
    totalCost: 18000,
  },
  {
    role: "QA Engineer",
    allocation: 70,
    estimatedHours: 280,
    costPerHour: 85,
    totalCost: 23800,
  },
];

const insightTemplates = [
  {
    type: "success" as const,
    title: "On Track for Completion",
    message: "Your plan is progressing well with ~45% of tasks completed and within budget.",
    recommendation: "Continue current pace and maintain focus on high-priority items.",
  },
  {
    type: "warning" as const,
    title: "Resource Allocation Alert",
    message: "Engineering is at 100% capacity. Consider reallocating from lower priority tasks.",
    recommendation: "Review task priorities and potentially defer non-critical work.",
  },
  {
    type: "info" as const,
    title: "Optimization Opportunity",
    message: "Parallel execution of independent tasks could reduce timeline by 1-2 weeks.",
    recommendation: "Identify tasks with no dependencies and execute simultaneously.",
  },
  {
    type: "success" as const,
    title: "Budget Status",
    message: "You're at 48% of planned budget with 65% of work completed. Good cost efficiency!",
    recommendation: "Maintain current spending patterns.",
  },
  {
    type: "warning" as const,
    title: "Timeline Risk",
    message: "The API Gateway milestone is approaching its due date. Current progress suggests it may slip by 3-5 days.",
    recommendation: "Allocate additional resources or reduce scope to meet deadline.",
  },
];

export const generateChatResponse = (query: string): MockAIResponse => {
  const response = chatResponses[Math.floor(Math.random() * chatResponses.length)];
  return {
    type: "success",
    content: response,
    metadata: {
      confidence: 0.85 + Math.random() * 0.1,
      sourceCount: Math.floor(Math.random() * 15) + 5,
    },
  };
};

export const generateTaskSuggestions = (): any[] => {
  const count = Math.floor(Math.random() * 2) + 2; // 2-3 suggestions
  const suggestions = [];
  const used = new Set<number>();

  for (let i = 0; i < count; i++) {
    let index: number;
    do {
      index = Math.floor(Math.random() * taskSuggestions.length);
    } while (used.has(index));

    used.add(index);
    suggestions.push(taskSuggestions[index]);
  }

  return suggestions;
};

export const generateResourcePlan = (resourceCount: number = 5, duration: number = 12): any => {
  // Adjust allocation based on resource count
  const adjustedPlans = resourcePlans.map(plan => ({
    ...plan,
    allocation: Math.min(plan.allocation, 100),
    estimatedHours: (duration * 40 * plan.allocation) / 100,
    totalCost: ((duration * 40 * plan.allocation) / 100) * plan.costPerHour,
  }));

  const totalCost = adjustedPlans.reduce((sum, plan) => sum + plan.totalCost, 0);
  const totalHours = adjustedPlans.reduce((sum, plan) => sum + plan.estimatedHours, 0);

  return {
    resourcePlans: adjustedPlans,
    summary: {
      totalResources: adjustedPlans.length,
      averageUtilization: 65,
      totalCost: Math.round(totalCost),
      totalHours: Math.round(totalHours),
      estimatedTimeline: `${duration} weeks`,
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + duration * 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
    },
    assumptions: [
      'Resources allocated at specified percentages',
      'Standard 40-hour work weeks',
      'No unplanned absences or holidays',
      'Steady velocity maintained throughout duration',
    ],
  };
};

export const generateInsights = (): MockInsight[] => {
  const count = Math.floor(Math.random() * 2) + 2; // 2-3 insights
  const insights = [];
  const used = new Set<number>();

  for (let i = 0; i < count; i++) {
    let index: number;
    do {
      index = Math.floor(Math.random() * insightTemplates.length);
    } while (used.has(index));

    used.add(index);
    insights.push(insightTemplates[index]);
  }

  return insights;
};

export const generateQuickInsights = (): Record<string, any> => {
  const insights = generateInsights();
  const plans = generateResourcePlan();

  return {
    insights,
    resourceUtilization: {
      average: 62 + Math.floor(Math.random() * 25),
      trend: ['up', 'down', 'stable'][Math.floor(Math.random() * 3)],
    },
    costTracking: {
      planned: 400000,
      spent: 180000,
      projected: 350000,
      status: 'under budget',
    },
    schedule: {
      plannedCompletion: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      riskLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 2)],
      criticalPath: ['Platform Modernization', 'Mobile App Launch'][
        Math.floor(Math.random() * 2)
      ],
    },
    recommendations: [
      'Focus on critical path items to maintain schedule',
      'Monitor resource utilization to prevent burnout',
      'Review and update risk mitigation strategies',
    ],
  };
};

// Task generation helpers
export const generateTagsFromTitle = (title: string): string[] => {
  const tags: string[] = [];
  const titleLower = title.toLowerCase();
  
  // Extract keywords and convert to tags
  if (titleLower.match(/design|ui|ux|interface/)) tags.push('design');
  if (titleLower.match(/test|qa|quality|check/)) tags.push('testing');
  if (titleLower.match(/database|db|schema|query|sql/)) tags.push('database');
  if (titleLower.match(/api|endpoint|rest|graphql|service/)) tags.push('backend');
  if (titleLower.match(/security|auth|permission|encrypt/)) tags.push('security');
  if (titleLower.match(/performance|optimize|speed|load/)) tags.push('performance');
  if (titleLower.match(/deploy|infra|k8s|kubernetes|docker|devops/)) tags.push('devops');
  if (titleLower.match(/documentation|doc|readme|guide/)) tags.push('documentation');
  if (titleLower.match(/mobile|ios|android|app/)) tags.push('mobile');
  if (titleLower.match(/react|frontend|ui component|page/)) tags.push('frontend');
  
  // If no tags matched, add generic ones based on context
  if (tags.length === 0) {
    tags.push('feature', 'task');
  }
  
  return tags.slice(0, 3); // Return max 3 tags
};

const toTitleCase = (value: string): string => {
  return value
    .split(' ')
    .filter(Boolean)
    .map(word => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
};

const generateScrumDescription = (title: string, projectName?: string): string => {
  const goal = toTitleCase(title.trim());
  const projectContext = projectName ? ` for ${projectName}` : '';
  const isProductDemo = title.trim().toLowerCase() === 'record a product demo';

  if (isProductDemo) {
    return [
      'User Story:',
      'As a product marketer, I want a concise and compelling product demo video so that prospects can quickly understand the value and key workflows.',
      '',
      'Background:',
      `This demo will be used in sales enablement and onboarding${projectContext ? ` for ${projectName}` : ''}. It should highlight the core user journey and the most differentiated features.`,
      '',
      'Acceptance Criteria:',
      '- Demo is 2–4 minutes long and follows a clear narrative arc (problem → solution → outcome).',
      '- Includes a brief intro, 3–5 key features, and a closing CTA.',
      '- Uses the latest UI and data from demo mode; no broken states or errors shown.',
      '- Audio is clear with no background noise; captions are included.',
      '- Final cut is uploaded to the shared drive and linked in the task.',
      '',
      'Subtasks:',
      '- Draft demo script and outline key scenes.',
      '- Prepare a clean demo workspace and seed data.',
      '- Record screen capture with voiceover.',
      '- Edit video, add captions, and export final cut.',
      '',
      'Definition of Done:',
      '- Stakeholder review completed and feedback addressed.',
      '- Video approved and published to the demo assets folder.',
      '- Link shared in the release notes/enablement doc.',
      '',
      'Notes:',
      '- Ensure branding guidelines are followed (logo placement, fonts, colors).',
      '- Avoid showing any real customer data or internal tools.',
    ].join('\n');
  }

  return [
    `User Story: As a member, I want to ${goal.toLowerCase()}${projectContext} so that we improve delivery quality and reliability.`,
    '',
    'Acceptance Criteria:',
    '- Clear definition of scope and key requirements documented.',
    '- Implementation completed and reviewed with no critical defects.',
    '- Tests updated/added to cover primary flows and edge cases.',
    '- Documentation updated where applicable.',
    '',
    'Subtasks:',
    '- Break work into 2–4 executable steps with owners.',
    '- Identify dependencies and confirm access/permissions.',
    '',
    'Definition of Done:',
    '- Code merged to main and deployed to demo environment.',
    '- QA verification completed with no critical issues.',
    '',
    'Notes:',
    '- Coordinate with relevant stakeholders before final validation.',
    '- Consider performance, security, and accessibility where relevant.',
  ].join('\n');
};

export const suggestAssigneeFromContext = (projectName?: string): string => {
  const projectAssignees: Record<string, string> = {
    'platform modernization': 'sarah@example.com',
    'mobile app': 'jessica@example.com',
    'design system': 'jessica@example.com',
    'ai features': 'alex@example.com',
    'infrastructure': 'marcus@example.com',
  };
  
  if (projectName) {
    const match = Object.entries(projectAssignees).find(([key]) =>
      projectName.toLowerCase().includes(key)
    );
    if (match) return match[1];
  }
  
  // Default assignees
  const defaultAssignees = ['sarah@example.com', 'alex@example.com', 'jessica@example.com', 'demo@example.com'];
  return defaultAssignees[Math.floor(Math.random() * defaultAssignees.length)];
};

const DEMO_USERS = [
  { email: 'sarah@example.com', name: 'Sarah Chen' },
  { email: 'alex@example.com', name: 'Alex Rodriguez' },
  { email: 'jessica@example.com', name: 'Jessica Murphy' },
  { email: 'demo@example.com', name: 'Demo User' },
  { email: 'james@example.com', name: 'James Wilson' },
  { email: 'marcus@example.com', name: 'Marcus Thompson' },
];

export const getAssigneeName = (email: string): string => {
  const user = DEMO_USERS.find(u => u.email === email);
  return user?.name || email;
};

export const generateScrumTaskDraft = (
  title: string,
  projectName?: string,
  descriptionOverride?: string
): {
  title: string;
  description: string;
  tags: string[];
} => {
  const description = descriptionOverride?.trim()
    ? descriptionOverride
    : generateScrumDescription(title, projectName);
  return {
    title: toTitleCase(title.trim()),
    description,
    tags: generateTagsFromTitle(title),
  };
};

// Chat response generators
const statusResponses = [
  'We\'re making steady progress. Current velocity is on track with the timeline.',
  'We\'ve hit some roadblocks but morale is high. Expect to catch up next sprint.',
  'Progress is excellent! We\'re ahead of schedule on critical items.',
  'Current status: 65% of tasks in progress, 25% completed. Timeline is solid.',
  'The platform is shaping up nicely. QA is catching some edge cases but nothing blocking.',
];

const recommendationResponses = [
  'I recommend prioritizing the critical path tasks and deferring nice-to-haves to the next phase.',
  'Consider breaking down larger tasks into smaller, more manageable chunks for better tracking.',
  'I suggest increasing test coverage to 80%+ before the next release to catch issues early.',
  'You might want to schedule a design review to ensure consistency across all modules.',
  'Consider automating the deployment pipeline to reduce manual overhead and errors.',
];

const planningResponses = [
  'Great idea! I suggest breaking this into 3-4 phases with clear milestones for each.',
  'For this initiative, I recommend allocating 2-3 developers and a designer for 6-8 weeks.',
  'A phased approach would work best: MVP first, then add advanced features based on feedback.',
  'I\'d suggest starting with user research and prototyping before full development.',
];

const generalResponses = [
  'That\'s a great question. Based on current capacity and priorities, I\'d recommend focusing on high-impact items first.',
  'I\'ve analyzed the current workload and timeline. We should be able to handle this with some optimization.',
  'Looking at the data, the best approach would be to prioritize based on risk and business impact.',
  'Everyone has been performing well. With the current velocity, we can achieve ambitious goals.',
  'I recommend setting up a weekly sync to track progress and adjust as needed.',
];

export const generateChatResponseFromContext = (
  message: string,
  citedContext?: any
): string => {
  const messageLower = message.toLowerCase();
  const citedTasks: any[] = citedContext?.tasks || [];
  const hasAuthTask = citedTasks.some(task => {
    const title = (task?.title || task?.name || '').toLowerCase();
    return title.includes('create authentication module');
  });

  if (hasAuthTask && messageLower.includes('implementation plan') && messageLower.includes('doc')) {
    return [
      'Here is a structured implementation plan you can paste into a doc:',
      '',
      'Title: Auth Module Implementation Plan',
      '',
      'Objective:',
      'Deliver a shared authentication module for iOS and Android that supports login, token refresh, and secure storage.',
      '',
      'Scope:',
      '- Auth flows: sign-in, token refresh, logout',
      '- Secure storage for tokens',
      '- Reusable API client and error handling',
      '- Basic unit tests and integration checks',
      '',
      'Milestones:',
      '1) Requirements & API Contract (0.5–1 day)',
      '2) Module Architecture + Interfaces (1 day)',
      '3) Core Implementation (2–3 days)',
      '4) QA + Unit Tests (1–2 days)',
      '5) Integration & Documentation (1 day)',
      '',
      'Implementation Steps:',
      '1. Gather requirements and confirm endpoints, auth scheme, and error responses.',
      '2. Define module interfaces: AuthService, TokenStore, and AuthState.',
      '3. Implement API client (login, refresh, logout) with retry/backoff.',
      '4. Implement secure token storage (Keychain/Keystore) and in-memory caching.',
      '5. Add session management and auto-refresh logic.',
      '6. Add basic unit tests for token handling and error mapping.',
      '7. Integrate module into app startup and logout flows.',
      '8. Update docs with usage examples and troubleshooting.',
      '',
      'Risks & Mitigations:',
      '- Token refresh edge cases → add retries + expiration checks.',
      '- Secure storage inconsistencies → abstract storage per platform.',
      '',
      'Definition of Done:',
      '- Module integrated in both iOS and Android builds.',
      '- All auth flows verified in demo mode.',
      '- Docs and examples added to the shared repo.',
    ].join('\n');
  }
  
  // Analyze message intent
  if (messageLower.match(/status|progress|how.*doing|where.*at/i)) {
    return statusResponses[Math.floor(Math.random() * statusResponses.length)];
  }
  if (messageLower.match(/help|suggest|recommend|advice|best.*practice|should.*do/i)) {
    return recommendationResponses[Math.floor(Math.random() * recommendationResponses.length)];
  }
  if (messageLower.match(/create|plan|build|develop|implement|schedule/i)) {
    return planningResponses[Math.floor(Math.random() * planningResponses.length)];
  }
  
  // Default response
  return generalResponses[Math.floor(Math.random() * generalResponses.length)];
};
