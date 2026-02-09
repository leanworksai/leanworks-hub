/**
 * Mock demo documents for demo mode
 */

export interface Doc {
  id: string;
  title: string;
  content?: string;
  owner_email: string;
  project_id?: string;
  team_id?: string;
  folder_id?: string;
  is_folder: boolean;
  doc_type: 'rich_text' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv';
  file_metadata?: Record<string, any>;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_error?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  visibility: 'all_members' | 'specific_members';
  visible_to_members?: string[];
  created_at: string;
  updated_at: string;
}

export const DEMO_DOCS: Doc[] = [
  // Folders
  {
    id: 'folder-001',
    title: 'Product Documentation',
    owner_email: 'demo@example.com',
    project_id: undefined,
    team_id: 'team-002',
    folder_id: undefined,
    is_folder: true,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['documentation', 'product'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'folder-002',
    title: 'Architecture & Design',
    owner_email: 'sarah@example.com',
    project_id: 'proj-001',
    team_id: undefined,
    folder_id: undefined,
    is_folder: true,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['architecture', 'design', 'technical'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'folder-003',
    title: 'Meeting Notes',
    owner_email: 'demo@example.com',
    project_id: undefined,
    team_id: undefined,
    folder_id: undefined,
    is_folder: true,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['meetings', 'notes'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },

  // Documents
  {
    id: 'doc-001',
    title: 'Q1 Product Roadmap',
    content: JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Q1 2026 Product Roadmap' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This roadmap outlines the key initiatives and features planned for Q1 2026.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Key Initiatives' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Mobile app launch' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'AI features integration' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Platform modernization' }],
                },
              ],
            },
          ],
        },
      ],
    }),
    owner_email: 'demo@example.com',
    project_id: undefined,
    team_id: 'team-002',
    folder_id: 'folder-001',
    is_folder: false,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['roadmap', 'product', 'q1'],
    metadata: {
      lastReviewDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'approved',
    },
    visibility: 'all_members',
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'doc-002',
    title: 'Microservices Architecture',
    content: JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Microservices Architecture' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This document outlines the planned microservices architecture for our platform.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Core Services' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Authentication Service - Handles user auth and tokens' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'API Gateway - Unified entry point for all requests' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Project Service - Manages projects and workflows' }],
                },
              ],
            },
          ],
        },
      ],
    }),
    owner_email: 'sarah@example.com',
    project_id: 'proj-001',
    team_id: undefined,
    folder_id: 'folder-002',
    is_folder: false,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['architecture', 'microservices', 'technical'],
    metadata: {
      version: '2.0',
      lastReviewDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    },
    visibility: 'all_members',
    created_at: new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'doc-003',
    title: 'Q1 Planning Meeting Notes',
    content: JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Q1 Planning Meeting - January 15, 2026' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Attendees: Demo User, Sarah Chen, Alex Rodriguez, Jessica Murphy, Marcus Thompson',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Outcomes' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Approved Q1 budget allocation - $250k for product initiatives',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Timeline: 12-week sprint ending March 31' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    owner_email: 'demo@example.com',
    project_id: undefined,
    team_id: undefined,
    folder_id: 'folder-003',
    is_folder: false,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['meeting', 'planning', 'q1'],
    metadata: {
      attendeeCount: 5,
      duration: 120,
    },
    visibility: 'all_members',
    created_at: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'doc-004',
    title: 'API Documentation',
    content: 'API documentation in progress...',
    owner_email: 'alex@example.com',
    project_id: 'proj-001',
    team_id: 'team-001',
    folder_id: 'folder-002',
    is_folder: false,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['api', 'documentation', 'technical'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'doc-005',
    title: 'Q1 Budget Report',
    content: 'Budget allocation and tracking spreadsheet',
    owner_email: 'demo@example.com',
    project_id: undefined,
    team_id: undefined,
    folder_id: undefined,
    is_folder: false,
    doc_type: 'xlsx',
    file_metadata: {
      fileName: 'q1-budget-report.xlsx',
      fileSize: 245000,
      sheetCount: 3,
      sheets: ['Summary', 'By Department', 'Forecast'],
    },
    processing_status: 'completed',
    tags: ['budget', 'finance', 'reporting'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'doc-006',
    title: 'Engineering Best Practices',
    content: 'Best practices guide for the engineering team',
    owner_email: 'sarah@example.com',
    project_id: 'proj-001',
    team_id: 'team-001',
    folder_id: undefined,
    is_folder: false,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['engineering', 'best-practices', 'guide'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'doc-007',
    title: 'Design System Guidelines',
    content: 'UI/UX design guidelines and component specifications',
    owner_email: 'jessica@example.com',
    project_id: 'proj-004',
    team_id: 'team-002',
    folder_id: undefined,
    is_folder: false,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['design', 'guidelines', 'ui-ux'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'doc-008',
    title: 'Infrastructure Deployment Guide',
    content: 'Step-by-step guide for deploying to production',
    owner_email: 'marcus@example.com',
    project_id: 'proj-005',
    team_id: 'team-003',
    folder_id: undefined,
    is_folder: false,
    doc_type: 'rich_text',
    processing_status: 'completed',
    tags: ['devops', 'deployment', 'infrastructure'],
    visibility: 'all_members',
    created_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const getDemoDocs = (): Doc[] => {
  return [...DEMO_DOCS];
};

export const getDocById = (docId: string): Doc | undefined => {
  return DEMO_DOCS.find(d => d.id === docId);
};

export const getDocsByTeamId = (teamId: string): Doc[] => {
  return DEMO_DOCS.filter(d => d.team_id === teamId);
};

export const getDocsByProjectId = (projectId: string): Doc[] => {
  return DEMO_DOCS.filter(d => d.project_id === projectId);
};

export const getDocsByFolderId = (folderId: string): Doc[] => {
  return DEMO_DOCS.filter(d => d.folder_id === folderId);
};

export const getDocFolders = (): Doc[] => {
  return DEMO_DOCS.filter(d => d.is_folder);
};
