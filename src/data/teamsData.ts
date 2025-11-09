export interface Team {
  name: string;
  members: number;
  projects: number;
  avatar: string;
  description: string;
  ownerEmail?: string; // Email of the team owner/creator
}

export interface TeamMember {
  name: string;
  role: string;
  email: string;
  avatar: string;
}

export interface TeamDetailData {
  name: string;
  description: string;
  avatar: string;
  members: TeamMember[];
  ownerEmail?: string; // Email of the team owner/creator
}

export interface TeamJoinRequest {
  id: string;
  teamName: string;
  userEmail: string;
  userName: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string | Date;
  ownerEmail: string;
}

