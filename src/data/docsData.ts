export interface DocFile {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
}

export interface Doc {
  id: string;
  title: string;
  content: string; // Rich text content (HTML)
  ownerEmail: string;
  projectId?: string | null;
  teamId?: string | null;
  isPinned: boolean;
  visibility?: 'all_members' | 'specific_members';
  visibleToMembers?: string[]; // Array of member emails who can view this doc
  metadata?: {
    files?: DocFile[];
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

