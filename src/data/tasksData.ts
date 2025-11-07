export interface TaskProgressUpdate {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  update: string;
  type?: "progress" | "blocker" | "milestone" | "question";
}

export interface TaskComment {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  comment: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "review" | "completed" | "blocked";
  priority: "low" | "medium" | "high" | "urgent";
  assignee: string;
  assigneeAvatar: string;
  project: string;
  projectId: string;
  dueDate: string;
  createdDate: string;
  createdAt?: number; // Timestamp in milliseconds for sorting
  estimatedHours?: number;
  actualHours?: number;
  tags: string[];
  progressUpdates: TaskProgressUpdate[];
  comments: TaskComment[];
}

let tasksData: Task[] = [
  {
    id: "task-1",
    title: "Implement new navigation system",
    description: "Design and implement a new navigation system for the mobile app with improved UX patterns and smooth transitions.",
    status: "in-progress",
    priority: "high",
    assignee: "Mike Johnson",
    assigneeAvatar: "MJ",
    project: "Mobile App Redesign",
    projectId: "mobile-app-redesign",
    dueDate: "Nov 20, 2024",
    createdDate: "Oct 15, 2024",
    estimatedHours: 40,
    actualHours: 28,
    tags: ["frontend", "mobile", "navigation"],
    comments: [
      {
        id: "comment-1",
        memberName: "Sarah Chen",
        memberAvatar: "SC",
        date: "Nov 11, 2024",
        comment: "Great progress! The navigation feels smooth. Looking forward to seeing the deep linking implementation."
      },
      {
        id: "comment-2",
        memberName: "Lisa Anderson",
        memberAvatar: "LA",
        date: "Nov 10, 2024",
        comment: "Can we add animations for the transitions? That would make it feel more polished."
      }
    ],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Mike Johnson",
        memberAvatar: "MJ",
        date: "Nov 10, 2024",
        type: "progress",
        update: "Navigation structure is 70% complete. All core screens are connected. Working on smooth transitions between screens and implementing the back button behavior."
      },
      {
        id: "update-2",
        memberName: "Mike Johnson",
        memberAvatar: "MJ",
        date: "Nov 8, 2024",
        type: "milestone",
        update: "Completed the bottom tab navigation. All main sections are now accessible. Next: deep linking implementation."
      },
      {
        id: "update-3",
        memberName: "Sarah Chen",
        memberAvatar: "SC",
        date: "Nov 7, 2024",
        type: "question",
        update: "Can we add a hamburger menu for secondary navigation? This would help with the overflow items."
      },
      {
        id: "update-4",
        memberName: "Mike Johnson",
        memberAvatar: "MJ",
        date: "Nov 5, 2024",
        type: "progress",
        update: "Started implementation. Created the base navigation components and routing structure. Setting up state management for navigation stack."
      }
    ]
  },
  {
    id: "task-2",
    title: "User testing sessions",
    description: "Conduct comprehensive user testing sessions with 15 participants to gather feedback on the new mobile app flow.",
    status: "in-progress",
    priority: "medium",
    assignee: "David Park",
    assigneeAvatar: "DP",
    project: "Mobile App Redesign",
    projectId: "mobile-app-redesign",
    dueDate: "Nov 25, 2024",
    createdDate: "Oct 20, 2024",
    estimatedHours: 24,
    actualHours: 16,
    tags: ["research", "ux", "testing"],
    comments: [
      {
        id: "comment-1",
        memberName: "Emma Wilson",
        memberAvatar: "EW",
        date: "Nov 9, 2024",
        comment: "Great idea about platform-specific feedback. Let's include both iOS and Android users."
      }
    ],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "David Park",
        memberAvatar: "DP",
        date: "Nov 9, 2024",
        type: "progress",
        update: "Completed 8 out of 15 sessions. Initial feedback is very positive. Users love the new navigation flow. Some concerns about discoverability of secondary features."
      },
      {
        id: "update-2",
        memberName: "David Park",
        memberAvatar: "DP",
        date: "Nov 6, 2024",
        type: "progress",
        update: "Recruited all 15 participants. Sessions scheduled for this week. Test script finalized and ready to go."
      },
      {
        id: "update-3",
        memberName: "Emma Wilson",
        memberAvatar: "EW",
        date: "Nov 5, 2024",
        type: "question",
        update: "Should we include users from both iOS and Android? Might be good to have platform-specific feedback."
      }
    ]
  },
  {
    id: "task-3",
    title: "Webhook retry mechanism",
    description: "Implement a robust webhook retry mechanism with exponential backoff to ensure reliable event delivery.",
    status: "in-progress",
    priority: "high",
    assignee: "James Brown",
    assigneeAvatar: "JB",
    project: "API Integration",
    projectId: "api-integration",
    dueDate: "Dec 1, 2024",
    createdDate: "Oct 25, 2024",
    estimatedHours: 32,
    actualHours: 22,
    tags: ["backend", "webhooks", "reliability"],
    comments: [],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "James Brown",
        memberAvatar: "JB",
        date: "Nov 9, 2024",
        type: "progress",
        update: "Exponential backoff implemented. Testing with various failure scenarios. Initial tests show 95% success rate on retries. Need to add dead letter queue for permanently failed webhooks."
      },
      {
        id: "update-2",
        memberName: "James Brown",
        memberAvatar: "JB",
        date: "Nov 7, 2024",
        type: "milestone",
        update: "Core retry logic is working. Webhooks are now queued and processed asynchronously. Next: implement exponential backoff."
      },
      {
        id: "update-3",
        memberName: "Alex Turner",
        memberAvatar: "AT",
        date: "Nov 6, 2024",
        type: "question",
        update: "What's our max retry count? Should we set it to 5 attempts or more?"
      },
      {
        id: "update-4",
        memberName: "James Brown",
        memberAvatar: "JB",
        date: "Nov 4, 2024",
        type: "progress",
        update: "Started working on the retry mechanism. Setting up the queue infrastructure first."
      }
    ]
  },
  {
    id: "task-4",
    title: "API documentation",
    description: "Create comprehensive API documentation including endpoints, request/response examples, and integration guides.",
    status: "in-progress",
    priority: "medium",
    assignee: "Nina Patel",
    assigneeAvatar: "NP",
    project: "API Integration",
    projectId: "api-integration",
    dueDate: "Dec 15, 2024",
    createdDate: "Nov 1, 2024",
    estimatedHours: 20,
    actualHours: 12,
    tags: ["documentation", "api"],
    comments: [],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Nina Patel",
        memberAvatar: "NP",
        date: "Nov 8, 2024",
        type: "progress",
        update: "Documented 8 out of 12 main endpoints. Added request/response examples for each. Working on authentication section next."
      },
      {
        id: "update-2",
        memberName: "Nina Patel",
        memberAvatar: "NP",
        date: "Nov 5, 2024",
        type: "progress",
        update: "Set up documentation structure using Swagger/OpenAPI. Starting with the core endpoints."
      }
    ]
  },
  {
    id: "task-5",
    title: "Performance testing",
    description: "Conduct comprehensive performance testing with large datasets to identify optimization opportunities.",
    status: "in-progress",
    priority: "high",
    assignee: "Marcus Johnson",
    assigneeAvatar: "MJ",
    project: "Dashboard Analytics",
    projectId: "dashboard-analytics",
    dueDate: "Nov 25, 2024",
    createdDate: "Nov 1, 2024",
    estimatedHours: 28,
    actualHours: 18,
    tags: ["testing", "performance", "optimization"],
    comments: [],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Marcus Johnson",
        memberAvatar: "MJ",
        date: "Nov 9, 2024",
        type: "progress",
        update: "Identified 3 major bottlenecks. Dashboard load time is 2.5s with 100k records. Need to implement pagination and lazy loading for charts."
      },
      {
        id: "update-2",
        memberName: "Marcus Johnson",
        memberAvatar: "MJ",
        date: "Nov 7, 2024",
        type: "blocker",
        update: "Found memory leak in chart rendering. Investigating the cause. This might delay the timeline."
      },
      {
        id: "update-3",
        memberName: "Marcus Johnson",
        memberAvatar: "MJ",
        date: "Nov 5, 2024",
        type: "progress",
        update: "Started performance testing. Set up test environment with production-like data. Running initial load tests."
      }
    ]
  },
  {
    id: "task-6",
    title: "A/B testing implementation",
    description: "Build A/B testing framework for email campaigns to test subject lines, content, and send times.",
    status: "in-progress",
    priority: "medium",
    assignee: "Laura Martinez",
    assigneeAvatar: "LM",
    project: "Email Campaign System",
    projectId: "email-campaign-system",
    dueDate: "Nov 25, 2024",
    createdDate: "Oct 28, 2024",
    estimatedHours: 36,
    actualHours: 24,
    tags: ["backend", "testing", "analytics"],
    comments: [],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Laura Martinez",
        memberAvatar: "LM",
        date: "Nov 10, 2024",
        type: "progress",
        update: "A/B testing framework is 80% complete. Variant splitting logic is working. Working on statistical significance calculations and reporting."
      },
      {
        id: "update-2",
        memberName: "Amanda Foster",
        memberAvatar: "AF",
        date: "Nov 8, 2024",
        type: "question",
        update: "What's the minimum sample size we need for statistical significance? Should we set it to 1000 recipients?"
      },
      {
        id: "update-3",
        memberName: "Laura Martinez",
        memberAvatar: "LM",
        date: "Nov 6, 2024",
        type: "milestone",
        update: "Core A/B testing logic implemented. Can now split campaigns into variants. Next: tracking and analytics."
      }
    ]
  },
  {
    id: "task-7",
    title: "Implement dark mode",
    description: "Add dark mode support to the mobile app with system preference detection and manual toggle.",
    status: "todo",
    priority: "low",
    assignee: "Emma Wilson",
    assigneeAvatar: "EW",
    project: "Mobile App Redesign",
    projectId: "mobile-app-redesign",
    dueDate: "Dec 5, 2024",
    createdDate: "Nov 1, 2024",
    estimatedHours: 24,
    tags: ["frontend", "mobile", "ui"],
    comments: [],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Emma Wilson",
        memberAvatar: "EW",
        date: "Nov 5, 2024",
        type: "progress",
        update: "Design system colors are defined for dark mode. Ready to start implementation once navigation task is complete."
      }
    ]
  },
  {
    id: "task-8",
    title: "Complete wireframes for all screens",
    description: "Create detailed wireframes for all mobile app screens including user flows and interaction patterns.",
    status: "completed",
    priority: "high",
    assignee: "Sarah Chen",
    assigneeAvatar: "SC",
    project: "Mobile App Redesign",
    projectId: "mobile-app-redesign",
    dueDate: "Nov 1, 2024",
    createdDate: "Sep 25, 2024",
    estimatedHours: 40,
    actualHours: 38,
    tags: ["design", "wireframes"],
    comments: [
      {
        id: "comment-1",
        memberName: "Mike Johnson",
        memberAvatar: "MJ",
        date: "Nov 1, 2024",
        comment: "Excellent work on the wireframes! The layouts are clear and easy to follow."
      }
    ],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Sarah Chen",
        memberAvatar: "SC",
        date: "Nov 1, 2024",
        type: "milestone",
        update: "All wireframes completed and approved! Handed off to development team. Total of 24 screens designed."
      },
      {
        id: "update-2",
        memberName: "Sarah Chen",
        memberAvatar: "SC",
        date: "Oct 28, 2024",
        type: "progress",
        update: "20 out of 24 screens completed. Working on the remaining checkout and settings screens."
      },
      {
        id: "update-3",
        memberName: "Sarah Chen",
        memberAvatar: "SC",
        date: "Oct 25, 2024",
        type: "progress",
        update: "Halfway through wireframes. Main navigation and core screens are done. Next: secondary flows."
      }
    ]
  },
  {
    id: "task-9",
    title: "Stripe payment integration",
    description: "Integrate Stripe payment processing for subscription and one-time payments.",
    status: "completed",
    priority: "high",
    assignee: "Nina Patel",
    assigneeAvatar: "NP",
    project: "API Integration",
    projectId: "api-integration",
    dueDate: "Nov 15, 2024",
    createdDate: "Oct 10, 2024",
    estimatedHours: 32,
    actualHours: 30,
    tags: ["backend", "payments", "stripe"],
    comments: [],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Nina Patel",
        memberAvatar: "NP",
        date: "Nov 15, 2024",
        type: "milestone",
        update: "Stripe integration is live in production! All payment flows tested and working. Subscription handling is complete."
      },
      {
        id: "update-2",
        memberName: "Nina Patel",
        memberAvatar: "NP",
        date: "Nov 12, 2024",
        type: "progress",
        update: "One-time payments working perfectly. Testing subscription flows now. Webhook handling is robust."
      },
      {
        id: "update-3",
        memberName: "Nina Patel",
        memberAvatar: "NP",
        date: "Nov 8, 2024",
        type: "progress",
        update: "Core Stripe integration complete. Payment processing is working. Next: subscription management and webhooks."
      }
    ]
  },
  {
    id: "task-10",
    title: "Analytics dashboard",
    description: "Build analytics dashboard for email campaign performance metrics including open rates and CTR.",
    status: "in-progress",
    priority: "medium",
    assignee: "Chris Evans",
    assigneeAvatar: "CE",
    project: "Email Campaign System",
    projectId: "email-campaign-system",
    dueDate: "Dec 5, 2024",
    createdDate: "Nov 1, 2024",
    estimatedHours: 28,
    actualHours: 16,
    tags: ["frontend", "analytics", "dashboard"],
    comments: [],
    progressUpdates: [
      {
        id: "update-1",
        memberName: "Chris Evans",
        memberAvatar: "CE",
        date: "Nov 9, 2024",
        type: "progress",
        update: "Dashboard UI is 60% complete. Charts for open rates and CTR are implemented. Working on conversion tracking next."
      },
      {
        id: "update-2",
        memberName: "Chris Evans",
        memberAvatar: "CE",
        date: "Nov 6, 2024",
        type: "progress",
        update: "Started building the analytics dashboard. Layout is done, integrating data from backend."
      }
    ]
  }
];

// Export tasks array
export const tasks = tasksData;

// Function to update a task
export const updateTask = (taskId: string, updatedTask: Partial<Task>) => {
  const index = tasksData.findIndex(t => t.id === taskId);
  if (index !== -1) {
    tasksData[index] = { ...tasksData[index], ...updatedTask };
    return true;
  }
  return false;
};

// Function to get a task by ID
export const getTaskById = (taskId: string): Task | undefined => {
  return tasksData.find(t => t.id === taskId);
};

