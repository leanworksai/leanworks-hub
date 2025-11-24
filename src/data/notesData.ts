export interface Note {
  id: string;
  title: string;
  content: string; // Rich text content (HTML)
  ownerEmail: string;
  projectId?: string | null;
  teamId?: string | null;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

