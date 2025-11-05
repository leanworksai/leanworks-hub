export interface Team {
  name: string;
  members: number;
  projects: number;
  avatar: string;
  description: string;
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
}

const defaultTeams: Team[] = [
  {
    name: "Engineering",
    members: 24,
    projects: 8,
    avatar: "E",
    description: "Core development team",
  },
  {
    name: "Design",
    members: 12,
    projects: 5,
    avatar: "D",
    description: "UI/UX and product design",
  },
  {
    name: "Product",
    members: 8,
    projects: 6,
    avatar: "P",
    description: "Product management",
  },
  {
    name: "Marketing",
    members: 6,
    projects: 3,
    avatar: "M",
    description: "Growth and marketing",
  },
  {
    name: "Support",
    members: 10,
    projects: 4,
    avatar: "S",
    description: "Customer support and success",
  },
];

const defaultTeamData: Record<string, TeamDetailData> = {
  Engineering: {
    name: "Engineering",
    description: "Core development team",
    avatar: "E",
    members: [
      { name: "Sarah Johnson", role: "Team Lead", email: "sarah@leanworks.ai", avatar: "SJ" },
      { name: "Michael Chen", role: "Senior Developer", email: "michael@leanworks.ai", avatar: "MC" },
      { name: "Alex Rivera", role: "Frontend Developer", email: "alex@leanworks.ai", avatar: "AR" },
      { name: "David Kim", role: "Backend Developer", email: "david@leanworks.ai", avatar: "DK" },
    ],
  },
  Design: {
    name: "Design",
    description: "UI/UX and product design",
    avatar: "D",
    members: [
      { name: "Emma Davis", role: "Design Lead", email: "emma@leanworks.ai", avatar: "ED" },
      { name: "Sophie Turner", role: "UI Designer", email: "sophie@leanworks.ai", avatar: "ST" },
      { name: "Lucas Brown", role: "UX Researcher", email: "lucas@leanworks.ai", avatar: "LB" },
    ],
  },
  Product: {
    name: "Product",
    description: "Product management",
    avatar: "P",
    members: [
      { name: "James Wilson", role: "Product Manager", email: "james@leanworks.ai", avatar: "JW" },
      { name: "Olivia Martinez", role: "Product Owner", email: "olivia@leanworks.ai", avatar: "OM" },
    ],
  },
  Marketing: {
    name: "Marketing",
    description: "Growth and marketing",
    avatar: "M",
    members: [
      { name: "Ryan Taylor", role: "Marketing Lead", email: "ryan@leanworks.ai", avatar: "RT" },
      { name: "Nina Patel", role: "Content Strategist", email: "nina@leanworks.ai", avatar: "NP" },
    ],
  },
  Support: {
    name: "Support",
    description: "Customer support and success",
    avatar: "S",
    members: [
      { name: "Jessica Lee", role: "Support Manager", email: "jessica@leanworks.ai", avatar: "JL" },
      { name: "Robert Smith", role: "Senior Support Specialist", email: "robert@leanworks.ai", avatar: "RS" },
      { name: "Maria Garcia", role: "Customer Success Specialist", email: "maria@leanworks.ai", avatar: "MG" },
      { name: "Kevin Thompson", role: "Technical Support", email: "kevin@leanworks.ai", avatar: "KT" },
      { name: "Amanda White", role: "Support Specialist", email: "amanda@leanworks.ai", avatar: "AW" },
    ],
  },
};

// LocalStorage keys
const TEAMS_STORAGE_KEY = "leanworks-teams";
const TEAM_DATA_STORAGE_KEY = "leanworks-team-data";

// Initialize teams from localStorage or use defaults
export function getTeams(): Team[] {
  if (typeof window === "undefined") return defaultTeams;
  
  const stored = localStorage.getItem(TEAMS_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return defaultTeams;
    }
  }
  return defaultTeams;
}

// Initialize team data from localStorage or use defaults
export function getTeamData(): Record<string, TeamDetailData> {
  if (typeof window === "undefined") return defaultTeamData;
  
  const stored = localStorage.getItem(TEAM_DATA_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return defaultTeamData;
    }
  }
  return defaultTeamData;
}

// Save teams to localStorage
export function saveTeams(teams: Team[]): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(teams));
  }
}

// Save team data to localStorage
export function saveTeamData(teamData: Record<string, TeamDetailData>): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(TEAM_DATA_STORAGE_KEY, JSON.stringify(teamData));
  }
}

// Add a new team
export function addTeam(team: Team, teamDetail: TeamDetailData): void {
  const teams = getTeams();
  const teamData = getTeamData();
  
  // Check if team already exists
  if (teams.some(t => t.name === team.name)) {
    throw new Error("Team with this name already exists");
  }
  
  teams.push(team);
  teamData[team.name] = teamDetail;
  
  saveTeams(teams);
  saveTeamData(teamData);
}

