/**
 * Mock Progress Data for Demo Mode
 * Contains task progress updates and project progress summaries
 */

export const DEMO_TASK_PROGRESS_UPDATES = [
  {
    id: 'update-001',
    updateId: 'update-001',
    projectId: 'proj-001',
    userId: 'sarah@example.com',
    userName: 'Sarah Chen',
    associatedTasks: ['task-002'],
    dateId: '2026-02-06',
    reason: 'Database schema migration',
    updateText: 'Completed auth service schema migration. All tables created and indexed. Ready for next phase.',
    timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'update-002',
    updateId: 'update-002',
    projectId: 'proj-001',
    userId: 'alex@example.com',
    userName: 'Alex Rodriguez',
    associatedTasks: ['task-001'],
    dateId: '2026-02-05',
    reason: 'API endpoint development',
    updateText: 'Implemented 8 new REST endpoints for user management. All endpoints tested and documented.',
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'update-003',
    updateId: 'update-003',
    projectId: 'proj-002',
    userId: 'maya@example.com',
    userName: 'Maya Patel',
    associatedTasks: ['task-003'],
    dateId: '2026-02-04',
    reason: 'UI component library',
    updateText: 'Completed 15 core UI components with responsive design. All components have Storybook documentation.',
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'update-004',
    updateId: 'update-004',
    projectId: 'proj-002',
    userId: 'james@example.com',
    userName: 'James Wilson',
    associatedTasks: ['task-004'],
    dateId: '2026-02-03',
    reason: 'Design system refinement',
    updateText: 'Finalized color palette and typography system. All design tokens documented in Figma.',
    timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'update-005',
    updateId: 'update-005',
    projectId: 'proj-003',
    userId: 'sarah@example.com',
    userName: 'Sarah Chen',
    associatedTasks: ['task-005'],
    dateId: '2026-02-02',
    reason: 'Mobile app testing',
    updateText: 'Completed comprehensive testing on iOS and Android. Found and logged 12 bugs. 8 already fixed.',
    timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'update-006',
    updateId: 'update-006',
    projectId: 'proj-001',
    userId: 'maya@example.com',
    userName: 'Maya Patel',
    associatedTasks: ['task-006'],
    dateId: '2026-02-01',
    reason: 'Security audit',
    updateText: 'Security audit completed. All critical vulnerabilities addressed. Preparing compliance report.',
    timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'update-007',
    updateId: 'update-007',
    projectId: 'proj-003',
    userId: 'james@example.com',
    userName: 'James Wilson',
    associatedTasks: ['task-007'],
    dateId: '2026-01-31',
    reason: 'Performance optimization',
    updateText: 'Optimized database queries. Reduced API response times by 40%. Cache strategy implemented.',
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'update-008',
    updateId: 'update-008',
    projectId: 'proj-002',
    userId: 'alex@example.com',
    userName: 'Alex Rodriguez',
    associatedTasks: ['task-008'],
    dateId: '2026-01-30',
    reason: 'Documentation update',
    updateText: 'Updated API documentation. Added 50+ code examples and integration guides.',
    timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const DEMO_PROJECT_PROGRESS_SUMMARIES = [
  {
    projectId: 'proj-001',
    projectName: 'Platform Modernization',
    dateId: '2026-02-06',
    updateSummary:
      'Strong progress on authentication service migration. Database schema complete and API endpoints 80% implemented. Velocity is steady. Security audit passed. On track for Q1 completion.',
    generatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    projectId: 'proj-002',
    projectName: 'Design System Refresh',
    dateId: '2026-02-06',
    updateSummary:
      'UI component library nearly complete with 15 core components delivered. Design tokens finalized and documented. Component adoption across projects is starting. Visual regression testing framework in place.',
    generatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    projectId: 'proj-003',
    projectName: 'Mobile App Launch',
    dateId: '2026-02-06',
    updateSummary:
      'Mobile app testing completed with successful results on both platforms. Performance optimizations reduced load times significantly. Most critical bugs resolved. Ready for beta testing phase. Release timeline remains on track.',
    generatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    projectId: 'proj-001',
    projectName: 'Platform Modernization',
    dateId: '2026-02-05',
    updateSummary:
      'API endpoint development is progressing faster than expected. 8 new endpoints deployed and tested. Database schema migration completed successfully. We\'re focused on integration testing this week.',
    generatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    projectId: 'proj-002',
    projectName: 'Design System Refresh',
    dateId: '2026-02-05',
    updateSummary:
      'Design system continues to mature. Component library expanded with 12 new components this week. Documentation quality has improved with automated Storybook generation. Adoption metrics show positive engagement.',
    generatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    projectId: 'proj-003',
    projectName: 'Mobile App Launch',
    dateId: '2026-02-05',
    updateSummary:
      'Comprehensive testing phase identified and resolved key bugs. Performance metrics show 40% improvement over previous build. Confidence is high for upcoming release. Preparing for beta user testing.',
    generatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];
