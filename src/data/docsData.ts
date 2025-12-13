export interface Doc {
  id: string;
  title: string;
  content: string; // Rich text content (HTML)
  ownerEmail: string;
  projectId?: string | null;
  teamId?: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

