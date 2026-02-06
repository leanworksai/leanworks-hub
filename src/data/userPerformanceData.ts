// User Performance Data - Mock historical data for AI resource planning

export interface UserPerformanceData {
  userId: string;
  userEmail: string;
  userName: string;
  normalizedHours: number; // Weekly hours based on historical contribution
  tasksCompletedPerWeek: number;
  updatesPerWeek: number;
  projectsCompleted: number;
  skills: string[];
  seniorityLevel: 'junior' | 'mid' | 'senior';
  hourlyRate: number;
  costEfficiency: number; // 0-100 (value delivered per dollar)
  reliability: number; // 0-100 (meets deadlines)
  currentAllocations: {
    planId: string;
    planName: string;
    percentage: number;
  }[];
  availability: number; // Percentage available for new work
}

export const mockUserPerformanceData: UserPerformanceData[] = [
  {
    userId: 'user-1',
    userEmail: 'sarah@example.com',
    userName: 'Sarah Chen',
    normalizedHours: 32,
    tasksCompletedPerWeek: 4,
    updatesPerWeek: 8,
    projectsCompleted: 12,
    skills: ['React', 'TypeScript', 'Node.js', 'System Design', 'Team Leadership'],
    seniorityLevel: 'senior',
    hourlyRate: 85,
    costEfficiency: 92,
    reliability: 95,
    currentAllocations: [
      { planId: 'plan-1', planName: 'Q1 2026 Product Launch', percentage: 80 },
    ],
    availability: 20,
  },
  {
    userId: 'user-2',
    userEmail: 'mike@example.com',
    userName: 'Mike Johnson',
    normalizedHours: 28,
    tasksCompletedPerWeek: 3.5,
    updatesPerWeek: 6,
    projectsCompleted: 8,
    skills: ['UI/UX Design', 'Figma', 'User Research', 'Prototyping'],
    seniorityLevel: 'mid',
    hourlyRate: 75,
    costEfficiency: 88,
    reliability: 90,
    currentAllocations: [
      { planId: 'plan-1', planName: 'Q1 2026 Product Launch', percentage: 60 },
    ],
    availability: 40,
  },
  {
    userId: 'user-3',
    userEmail: 'emma@example.com',
    userName: 'Emma Wilson',
    normalizedHours: 38,
    tasksCompletedPerWeek: 5,
    updatesPerWeek: 10,
    projectsCompleted: 15,
    skills: ['Python', 'PostgreSQL', 'API Design', 'Microservices', 'DevOps'],
    seniorityLevel: 'senior',
    hourlyRate: 80,
    costEfficiency: 94,
    reliability: 98,
    currentAllocations: [
      { planId: 'plan-1', planName: 'Q1 2026 Product Launch', percentage: 100 },
      { planId: 'plan-2', planName: 'Infrastructure Modernization', percentage: 40 },
    ],
    availability: 0, // Fully allocated
  },
  {
    userId: 'user-4',
    userEmail: 'alex@example.com',
    userName: 'Alex Rodriguez',
    normalizedHours: 30,
    tasksCompletedPerWeek: 3,
    updatesPerWeek: 7,
    projectsCompleted: 6,
    skills: ['Vue.js', 'CSS', 'JavaScript', 'Responsive Design'],
    seniorityLevel: 'mid',
    hourlyRate: 78,
    costEfficiency: 85,
    reliability: 87,
    currentAllocations: [
      { planId: 'plan-1', planName: 'Q1 2026 Product Launch', percentage: 50 },
    ],
    availability: 50,
  },
  {
    userId: 'user-5',
    userEmail: 'james@example.com',
    userName: 'James Liu',
    normalizedHours: 36,
    tasksCompletedPerWeek: 4.5,
    updatesPerWeek: 9,
    projectsCompleted: 10,
    skills: ['Kubernetes', 'Docker', 'AWS', 'Terraform', 'CI/CD'],
    seniorityLevel: 'senior',
    hourlyRate: 95,
    costEfficiency: 90,
    reliability: 93,
    currentAllocations: [
      { planId: 'plan-2', planName: 'Infrastructure Modernization', percentage: 90 },
    ],
    availability: 10,
  },
  {
    userId: 'user-6',
    userEmail: 'lisa@example.com',
    userName: 'Lisa Park',
    normalizedHours: 34,
    tasksCompletedPerWeek: 4,
    updatesPerWeek: 8,
    projectsCompleted: 11,
    skills: ['Cloud Architecture', 'Security', 'Performance Optimization', 'GCP'],
    seniorityLevel: 'senior',
    hourlyRate: 100,
    costEfficiency: 91,
    reliability: 96,
    currentAllocations: [
      { planId: 'plan-2', planName: 'Infrastructure Modernization', percentage: 70 },
    ],
    availability: 30,
  },
  {
    userId: 'user-7',
    userEmail: 'rachel@example.com',
    userName: 'Rachel Kim',
    normalizedHours: 40,
    tasksCompletedPerWeek: 5,
    updatesPerWeek: 12,
    projectsCompleted: 20,
    skills: ['Customer Success', 'Support Operations', 'Team Management', 'Analytics'],
    seniorityLevel: 'senior',
    hourlyRate: 70,
    costEfficiency: 89,
    reliability: 97,
    currentAllocations: [
      { planId: 'plan-3', planName: 'Customer Success Initiative', percentage: 100 },
    ],
    availability: 0,
  },
  {
    userId: 'user-8',
    userEmail: 'david@example.com',
    userName: 'David Brown',
    normalizedHours: 25,
    tasksCompletedPerWeek: 2.5,
    updatesPerWeek: 5,
    projectsCompleted: 4,
    skills: ['Technical Writing', 'Documentation', 'Content Strategy'],
    seniorityLevel: 'mid',
    hourlyRate: 65,
    costEfficiency: 86,
    reliability: 88,
    currentAllocations: [
      { planId: 'plan-3', planName: 'Customer Success Initiative', percentage: 50 },
    ],
    availability: 50,
  },
  {
    userId: 'user-9',
    userEmail: 'sophia@example.com',
    userName: 'Sophia Martinez',
    normalizedHours: 38,
    tasksCompletedPerWeek: 4.5,
    updatesPerWeek: 9,
    projectsCompleted: 14,
    skills: ['iOS', 'Swift', 'Mobile Design', 'App Store Optimization'],
    seniorityLevel: 'senior',
    hourlyRate: 90,
    costEfficiency: 93,
    reliability: 94,
    currentAllocations: [
      { planId: 'plan-4', planName: 'Mobile Platform Expansion', percentage: 100 },
    ],
    availability: 0,
  },
  {
    userId: 'user-10',
    userEmail: 'tom@example.com',
    userName: 'Tom Anderson',
    normalizedHours: 36,
    tasksCompletedPerWeek: 4,
    updatesPerWeek: 8,
    projectsCompleted: 13,
    skills: ['Android', 'Kotlin', 'Mobile Testing', 'Play Store'],
    seniorityLevel: 'senior',
    hourlyRate: 88,
    costEfficiency: 91,
    reliability: 92,
    currentAllocations: [
      { planId: 'plan-4', planName: 'Mobile Platform Expansion', percentage: 100 },
    ],
    availability: 0,
  },
  {
    userId: 'user-11',
    userEmail: 'nina@example.com',
    userName: 'Nina Patel',
    normalizedHours: 32,
    tasksCompletedPerWeek: 3.5,
    updatesPerWeek: 7,
    projectsCompleted: 9,
    skills: ['QA Testing', 'Automation', 'Bug Tracking', 'Test Plans'],
    seniorityLevel: 'mid',
    hourlyRate: 72,
    costEfficiency: 87,
    reliability: 91,
    currentAllocations: [
      { planId: 'plan-4', planName: 'Mobile Platform Expansion', percentage: 80 },
    ],
    availability: 20,
  },
  {
    userId: 'user-12',
    userEmail: 'marcus@example.com',
    userName: 'Marcus Johnson',
    normalizedHours: 40,
    tasksCompletedPerWeek: 5,
    updatesPerWeek: 10,
    projectsCompleted: 18,
    skills: ['Security', 'Compliance', 'Penetration Testing', 'Risk Assessment'],
    seniorityLevel: 'senior',
    hourlyRate: 110,
    costEfficiency: 90,
    reliability: 99,
    currentAllocations: [
      { planId: 'plan-5', planName: 'Enterprise Security Compliance', percentage: 100 },
    ],
    availability: 0,
  },
  {
    userId: 'user-13',
    userEmail: 'olivia@example.com',
    userName: 'Olivia Chen',
    normalizedHours: 35,
    tasksCompletedPerWeek: 4,
    updatesPerWeek: 8,
    projectsCompleted: 7,
    skills: ['Compliance', 'Audit', 'Documentation', 'Policy Writing'],
    seniorityLevel: 'mid',
    hourlyRate: 95,
    costEfficiency: 88,
    reliability: 94,
    currentAllocations: [
      { planId: 'plan-5', planName: 'Enterprise Security Compliance', percentage: 60 },
    ],
    availability: 40,
  },
  // Additional available team members
  {
    userId: 'user-14',
    userEmail: 'carlos@example.com',
    userName: 'Carlos Mendez',
    normalizedHours: 24,
    tasksCompletedPerWeek: 2,
    updatesPerWeek: 4,
    projectsCompleted: 3,
    skills: ['JavaScript', 'React', 'CSS', 'Git'],
    seniorityLevel: 'junior',
    hourlyRate: 55,
    costEfficiency: 82,
    reliability: 85,
    currentAllocations: [],
    availability: 100,
  },
  {
    userId: 'user-15',
    userEmail: 'priya@example.com',
    userName: 'Priya Sharma',
    normalizedHours: 26,
    tasksCompletedPerWeek: 2.5,
    updatesPerWeek: 5,
    projectsCompleted: 4,
    skills: ['Python', 'Django', 'SQL', 'REST APIs'],
    seniorityLevel: 'junior',
    hourlyRate: 58,
    costEfficiency: 84,
    reliability: 86,
    currentAllocations: [],
    availability: 100,
  },
  {
    userId: 'user-16',
    userEmail: 'kevin@example.com',
    userName: 'Kevin Zhang',
    normalizedHours: 30,
    tasksCompletedPerWeek: 3,
    updatesPerWeek: 6,
    projectsCompleted: 7,
    skills: ['Data Analysis', 'SQL', 'Python', 'Reporting', 'Analytics'],
    seniorityLevel: 'mid',
    hourlyRate: 70,
    costEfficiency: 86,
    reliability: 89,
    currentAllocations: [],
    availability: 100,
  },
];

// Helper functions
export const getUserPerformance = (userEmail: string): UserPerformanceData | undefined => {
  return mockUserPerformanceData.find(u => u.userEmail.toLowerCase() === userEmail.toLowerCase());
};

export const getAvailableUsers = (minAvailability: number = 0): UserPerformanceData[] => {
  return mockUserPerformanceData.filter(u => u.availability >= minAvailability);
};

export const getUsersBySkill = (skill: string): UserPerformanceData[] => {
  const lowerSkill = skill.toLowerCase();
  return mockUserPerformanceData.filter(u => 
    u.skills.some(s => s.toLowerCase().includes(lowerSkill))
  );
};

export const getUsersBySeniority = (level: 'junior' | 'mid' | 'senior'): UserPerformanceData[] => {
  return mockUserPerformanceData.filter(u => u.seniorityLevel === level);
};
