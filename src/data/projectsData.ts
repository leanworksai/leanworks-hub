export interface ProjectMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
}

export interface Task {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "completed";
  assignee: string;
  dueDate: string;
}

export interface ProgressUpdate {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  update: string;
}

export interface Comment {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  comment: string;
}

export interface Project {
  name: string;
  description: string;
  detailedDescription: string;
  status: string;
  team: number;
  dueDate: string;
  createdDate: string;
  statusColor: string;
  members: ProjectMember[];
  tasks: Task[];
  progressUpdates: ProgressUpdate[];
  comments: Comment[];
  summary: {
    accomplishment: string;
    decision: string;
    risk: string;
    direction: string;
  };
}

export const projects: Project[] = [
  {
    name: "Mobile App Redesign",
    description: "Complete overhaul of the mobile experience",
    detailedDescription: "This project aims to completely transform our mobile application experience by implementing modern design patterns, improving user flows, and enhancing overall performance. We're focusing on creating an intuitive interface that reduces friction and increases user engagement across all mobile platforms.",
    status: "In Progress",
    team: 8,
    dueDate: "Dec 15, 2024",
    createdDate: "Oct 1, 2024",
    statusColor: "bg-blue-500",
    members: [
      { id: "1", name: "Sarah Chen", role: "Lead Designer", avatar: "SC" },
      { id: "2", name: "Mike Johnson", role: "iOS Developer", avatar: "MJ" },
      { id: "3", name: "Emma Wilson", role: "Android Developer", avatar: "EW" },
      { id: "4", name: "David Park", role: "UX Researcher", avatar: "DP" },
      { id: "5", name: "Lisa Anderson", role: "Product Manager", avatar: "LA" },
      { id: "6", name: "Tom Rodriguez", role: "QA Engineer", avatar: "TR" },
      { id: "7", name: "Amy Zhang", role: "UI Designer", avatar: "AZ" },
      { id: "8", name: "Chris Taylor", role: "Backend Developer", avatar: "CT" },
    ],
    tasks: [
      { id: "1", title: "Complete wireframes for all screens", status: "completed", assignee: "Sarah Chen", dueDate: "Nov 1, 2024" },
      { id: "2", title: "Implement new navigation system", status: "in-progress", assignee: "Mike Johnson", dueDate: "Nov 20, 2024" },
      { id: "3", title: "Design component library", status: "completed", assignee: "Amy Zhang", dueDate: "Nov 5, 2024" },
      { id: "4", title: "User testing sessions", status: "in-progress", assignee: "David Park", dueDate: "Nov 25, 2024" },
      { id: "5", title: "Implement dark mode", status: "todo", assignee: "Emma Wilson", dueDate: "Dec 5, 2024" },
      { id: "6", title: "Performance optimization", status: "todo", assignee: "Chris Taylor", dueDate: "Dec 10, 2024" },
    ],
    comments: [
      { id: "comment-1", memberName: "Lisa Anderson", memberAvatar: "LA", date: "Nov 11, 2024", comment: "The team is making great progress! Keep up the excellent work." },
      { id: "comment-2", memberName: "Tom Rodriguez", memberAvatar: "TR", date: "Nov 10, 2024", comment: "Should we schedule a review meeting for next week to align on the progress?" },
    ],
    progressUpdates: [
      { id: "1", memberName: "Sarah Chen", memberAvatar: "SC", date: "Nov 10, 2024", update: "Completed the final design mockups and handed off to developers. All screens are now ready for implementation." },
      { id: "2", memberName: "Mike Johnson", memberAvatar: "MJ", date: "Nov 9, 2024", update: "Navigation system is 70% complete. Working on smooth transitions between screens." },
      { id: "3", memberName: "David Park", memberAvatar: "DP", date: "Nov 8, 2024", update: "Conducted user testing with 15 participants. Gathering feedback on the new flow." },
      { id: "4", memberName: "Emma Wilson", memberAvatar: "EW", date: "Nov 7, 2024", update: "Android implementation is progressing well. Core features are working as expected." },
    ],
    summary: {
      accomplishment: "Completed user flow redesign and prototyping",
      decision: "Decided to adopt React Native for cross-platform support",
      risk: "Timeline might slip due to API dependencies",
      direction: "Moving towards beta testing phase",
    },
  },
  {
    name: "API Integration",
    description: "Third-party API connections and webhooks",
    detailedDescription: "Integrating multiple third-party APIs to enhance our platform capabilities. This includes payment processing, email delivery, analytics, and various other services. We're building a robust webhook system to handle real-time events and ensure reliability across all integrations.",
    status: "In Progress",
    team: 5,
    dueDate: "Jan 20, 2025",
    createdDate: "Oct 15, 2024",
    statusColor: "bg-blue-500",
    members: [
      { id: "1", name: "Alex Turner", role: "Backend Lead", avatar: "AT" },
      { id: "2", name: "Rachel Kim", role: "DevOps Engineer", avatar: "RK" },
      { id: "3", name: "James Brown", role: "Full Stack Developer", avatar: "JB" },
      { id: "4", name: "Nina Patel", role: "API Specialist", avatar: "NP" },
      { id: "5", name: "Sam Lee", role: "QA Engineer", avatar: "SL" },
    ],
    tasks: [
      { id: "1", title: "Stripe payment integration", status: "completed", assignee: "Nina Patel", dueDate: "Nov 15, 2024" },
      { id: "2", title: "SendGrid email setup", status: "completed", assignee: "Alex Turner", dueDate: "Nov 18, 2024" },
      { id: "3", title: "Webhook retry mechanism", status: "in-progress", assignee: "James Brown", dueDate: "Dec 1, 2024" },
      { id: "4", title: "API documentation", status: "in-progress", assignee: "Nina Patel", dueDate: "Dec 15, 2024" },
      { id: "5", title: "Load testing", status: "todo", assignee: "Rachel Kim", dueDate: "Jan 10, 2025" },
    ],
    comments: [
      { id: "comment-1", memberName: "Sam Lee", memberAvatar: "SL", date: "Nov 10, 2024", comment: "Great work on the Stripe integration! The payment flows look solid." },
    ],
    progressUpdates: [
      { id: "1", memberName: "Nina Patel", memberAvatar: "NP", date: "Nov 10, 2024", update: "Stripe integration is live in production. All payment flows are working smoothly." },
      { id: "2", memberName: "Alex Turner", memberAvatar: "AT", date: "Nov 9, 2024", update: "SendGrid integration complete. Email delivery rates are excellent at 98%." },
      { id: "3", memberName: "James Brown", memberAvatar: "JB", date: "Nov 8, 2024", update: "Implementing exponential backoff for webhook retries. Initial tests are promising." },
    ],
    summary: {
      accomplishment: "Integrated Stripe and SendGrid APIs successfully",
      decision: "Using webhook retry mechanism for reliability",
      risk: "Rate limiting on third-party APIs",
      direction: "Focus on error handling and monitoring",
    },
  },
  {
    name: "Dashboard Analytics",
    description: "Real-time analytics and reporting dashboard",
    detailedDescription: "Building a comprehensive analytics dashboard that provides real-time insights into user behavior, system performance, and business metrics. The dashboard will feature interactive charts, customizable widgets, and automated reporting capabilities to help stakeholders make data-driven decisions.",
    status: "Review",
    team: 6,
    dueDate: "Nov 30, 2024",
    createdDate: "Sep 20, 2024",
    statusColor: "bg-yellow-500",
    members: [
      { id: "1", name: "Kevin Martinez", role: "Data Engineer", avatar: "KM" },
      { id: "2", name: "Sophie Anderson", role: "Frontend Developer", avatar: "SA" },
      { id: "3", name: "Ryan Cooper", role: "Backend Developer", avatar: "RC" },
      { id: "4", name: "Olivia White", role: "UI/UX Designer", avatar: "OW" },
      { id: "5", name: "Marcus Johnson", role: "DevOps", avatar: "MJ" },
      { id: "6", name: "Diana Ross", role: "Product Manager", avatar: "DR" },
    ],
    tasks: [
      { id: "1", title: "Design dashboard layout", status: "completed", assignee: "Olivia White", dueDate: "Oct 15, 2024" },
      { id: "2", title: "Implement chart components", status: "completed", assignee: "Sophie Anderson", dueDate: "Nov 10, 2024" },
      { id: "3", title: "WebSocket integration", status: "completed", assignee: "Ryan Cooper", dueDate: "Nov 15, 2024" },
      { id: "4", title: "Performance testing", status: "in-progress", assignee: "Marcus Johnson", dueDate: "Nov 25, 2024" },
      { id: "5", title: "User acceptance testing", status: "in-progress", assignee: "Diana Ross", dueDate: "Nov 28, 2024" },
    ],
    comments: [],
    progressUpdates: [
      { id: "1", memberName: "Sophie Anderson", memberAvatar: "SA", date: "Nov 10, 2024", update: "All chart components are implemented and looking great. Ready for final review." },
      { id: "2", memberName: "Ryan Cooper", memberAvatar: "RC", date: "Nov 9, 2024", update: "WebSocket connection is stable. Real-time updates are working perfectly." },
      { id: "3", memberName: "Marcus Johnson", memberAvatar: "MJ", date: "Nov 8, 2024", update: "Started performance testing with large datasets. Identifying optimization opportunities." },
    ],
    summary: {
      accomplishment: "All charts and metrics implemented",
      decision: "Using WebSockets for real-time updates",
      risk: "Performance optimization needed for large datasets",
      direction: "Final review and performance testing",
    },
  },
  {
    name: "User Authentication",
    description: "Enhanced security and SSO implementation",
    detailedDescription: "Implementing a robust authentication system with support for multiple authentication methods including email/password, social login (Google, Microsoft), and enterprise SSO. The system includes JWT token management, refresh token rotation, and comprehensive security measures to protect user accounts.",
    status: "Completed",
    team: 4,
    dueDate: "Nov 15, 2024",
    createdDate: "Sep 1, 2024",
    statusColor: "bg-green-500",
    members: [
      { id: "1", name: "Patricia Davis", role: "Security Engineer", avatar: "PD" },
      { id: "2", name: "Robert Miller", role: "Backend Developer", avatar: "RM" },
      { id: "3", name: "Jennifer Lee", role: "Frontend Developer", avatar: "JL" },
      { id: "4", name: "William Chen", role: "QA Engineer", avatar: "WC" },
    ],
    tasks: [
      { id: "1", title: "JWT implementation", status: "completed", assignee: "Robert Miller", dueDate: "Oct 10, 2024" },
      { id: "2", title: "Google SSO integration", status: "completed", assignee: "Patricia Davis", dueDate: "Oct 20, 2024" },
      { id: "3", title: "Microsoft SSO integration", status: "completed", assignee: "Patricia Davis", dueDate: "Oct 25, 2024" },
      { id: "4", title: "Login UI components", status: "completed", assignee: "Jennifer Lee", dueDate: "Nov 1, 2024" },
      { id: "5", title: "Security audit", status: "completed", assignee: "William Chen", dueDate: "Nov 10, 2024" },
    ],
    comments: [],
    progressUpdates: [
      { id: "1", memberName: "Patricia Davis", memberAvatar: "PD", date: "Nov 12, 2024", update: "Project successfully deployed to production. All security measures are in place." },
      { id: "2", memberName: "William Chen", memberAvatar: "WC", date: "Nov 10, 2024", update: "Security audit completed. No critical issues found. System is production-ready." },
      { id: "3", memberName: "Robert Miller", memberAvatar: "RM", date: "Nov 8, 2024", update: "Token refresh mechanism is working flawlessly. Implemented automatic session extension." },
    ],
    summary: {
      accomplishment: "SSO integration with Google and Microsoft complete",
      decision: "Implemented JWT with refresh token rotation",
      risk: "None - project completed successfully",
      direction: "Monitoring production performance",
    },
  },
  {
    name: "Payment Gateway",
    description: "Stripe integration and checkout flow",
    detailedDescription: "Developing a complete payment processing system using Stripe. This includes creating a smooth checkout experience, handling various payment methods, managing subscriptions, and implementing proper error handling and retry logic. The system will also include comprehensive analytics and reporting for financial transactions.",
    status: "Planning",
    team: 3,
    dueDate: "Feb 10, 2025",
    createdDate: "Nov 1, 2024",
    statusColor: "bg-gray-500",
    members: [
      { id: "1", name: "Michael Brown", role: "Backend Developer", avatar: "MB" },
      { id: "2", name: "Sarah Thompson", role: "Frontend Developer", avatar: "ST" },
      { id: "3", name: "Daniel Kim", role: "Product Manager", avatar: "DK" },
    ],
    tasks: [
      { id: "1", title: "Requirements gathering", status: "completed", assignee: "Daniel Kim", dueDate: "Nov 10, 2024" },
      { id: "2", title: "Architecture design", status: "in-progress", assignee: "Michael Brown", dueDate: "Nov 20, 2024" },
      { id: "3", title: "Stripe account setup", status: "todo", assignee: "Michael Brown", dueDate: "Nov 25, 2024" },
      { id: "4", title: "Checkout UI mockups", status: "todo", assignee: "Sarah Thompson", dueDate: "Dec 1, 2024" },
    ],
    comments: [],
    progressUpdates: [
      { id: "1", memberName: "Daniel Kim", memberAvatar: "DK", date: "Nov 10, 2024", update: "Completed requirements gathering. Documented all payment flows and edge cases." },
      { id: "2", memberName: "Michael Brown", memberAvatar: "MB", date: "Nov 8, 2024", update: "Working on architecture design. Evaluating different Stripe integration approaches." },
    ],
    summary: {
      accomplishment: "Requirements gathering and architecture design",
      decision: "Using Stripe Checkout for initial implementation",
      risk: "Regulatory compliance requirements need review",
      direction: "Starting development sprint next week",
    },
  },
  {
    name: "Email Campaign System",
    description: "Automated marketing email workflows",
    detailedDescription: "Creating an automated email marketing system that allows teams to design, schedule, and track email campaigns. The system includes a template builder, audience segmentation, A/B testing capabilities, and detailed analytics on email performance including open rates, click-through rates, and conversions.",
    status: "In Progress",
    team: 4,
    dueDate: "Dec 28, 2024",
    createdDate: "Oct 10, 2024",
    statusColor: "bg-blue-500",
    members: [
      { id: "1", name: "Laura Martinez", role: "Full Stack Developer", avatar: "LM" },
      { id: "2", name: "Chris Evans", role: "Frontend Developer", avatar: "CE" },
      { id: "3", name: "Amanda Foster", role: "Marketing Manager", avatar: "AF" },
      { id: "4", name: "Brian Wilson", role: "DevOps Engineer", avatar: "BW" },
    ],
    tasks: [
      { id: "1", title: "Email template system", status: "completed", assignee: "Chris Evans", dueDate: "Nov 5, 2024" },
      { id: "2", title: "Campaign scheduler", status: "completed", assignee: "Laura Martinez", dueDate: "Nov 12, 2024" },
      { id: "3", title: "A/B testing implementation", status: "in-progress", assignee: "Laura Martinez", dueDate: "Nov 25, 2024" },
      { id: "4", title: "Analytics dashboard", status: "in-progress", assignee: "Chris Evans", dueDate: "Dec 5, 2024" },
      { id: "5", title: "Audience segmentation", status: "todo", assignee: "Amanda Foster", dueDate: "Dec 15, 2024" },
    ],
    comments: [],
    progressUpdates: [
      { id: "1", memberName: "Laura Martinez", memberAvatar: "LM", date: "Nov 10, 2024", update: "A/B testing framework is coming together nicely. Should be ready for testing soon." },
      { id: "2", memberName: "Chris Evans", memberAvatar: "CE", date: "Nov 9, 2024", update: "Template builder is working great. Users can create beautiful emails with drag-and-drop." },
      { id: "3", memberName: "Amanda Foster", memberAvatar: "AF", date: "Nov 8, 2024", update: "Reviewing deliverability metrics. Working with SendGrid to improve our sender reputation." },
    ],
    summary: {
      accomplishment: "Template system and scheduler built",
      decision: "Using SendGrid for email delivery",
      risk: "Email deliverability rates need improvement",
      direction: "A/B testing implementation in progress",
    },
  },
];
