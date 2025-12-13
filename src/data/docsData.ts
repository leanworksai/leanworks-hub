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
  createdAt: string;
  updatedAt: string;
}

