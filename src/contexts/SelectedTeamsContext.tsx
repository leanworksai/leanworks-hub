import { createContext, useContext, useState, ReactNode } from "react";
import { Team } from "@/data/teamsData";
import { trackContextSelect } from "@/lib/analytics";

interface SelectedTeamsContextType {
  selectedTeams: Team[];
  toggleTeam: (team: Team) => void;
  isTeamSelected: (teamName: string) => boolean;
  clearSelection: () => void;
}

const SelectedTeamsContext = createContext<SelectedTeamsContextType | undefined>(undefined);

export function SelectedTeamsProvider({ children }: { children: ReactNode }) {
  const [selectedTeams, setSelectedTeams] = useState<Team[]>([]);

  const toggleTeam = (team: Team) => {
    setSelectedTeams((prev) => {
      const isSelected = prev.some((t) => t.name === team.name);
      if (isSelected) {
        trackContextSelect('team', team.id || team.name, 'deselect');
        return prev.filter((t) => t.name !== team.name);
      } else {
        trackContextSelect('team', team.id || team.name, 'select');
        return [...prev, team];
      }
    });
  };

  const isTeamSelected = (teamName: string) => {
    return selectedTeams.some((t) => t.name === teamName);
  };

  const clearSelection = () => {
    setSelectedTeams([]);
  };

  return (
    <SelectedTeamsContext.Provider
      value={{
        selectedTeams,
        toggleTeam,
        isTeamSelected,
        clearSelection,
      }}
    >
      {children}
    </SelectedTeamsContext.Provider>
  );
}

export function useSelectedTeams() {
  const context = useContext(SelectedTeamsContext);
  if (context === undefined) {
    throw new Error("useSelectedTeams must be used within a SelectedTeamsProvider");
  }
  return context;
}

