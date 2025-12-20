import { createContext, useContext, useState, ReactNode } from "react";
import { Project } from "@/data/projectsData";
import { trackContextSelect } from "@/lib/analytics";

interface SelectedProjectsContextType {
  selectedProjects: Project[];
  toggleProject: (project: Project) => void;
  isProjectSelected: (projectId: string) => boolean;
  clearSelection: () => void;
}

const SelectedProjectsContext = createContext<SelectedProjectsContextType | undefined>(undefined);

export function SelectedProjectsProvider({ children }: { children: ReactNode }) {
  const [selectedProjects, setSelectedProjects] = useState<Project[]>([]);

  const toggleProject = (project: Project) => {
    setSelectedProjects((prev) => {
      const isSelected = prev.some((p) => p.id === project.id);
      if (isSelected) {
        trackContextSelect('project', project.id, 'deselect');
        return prev.filter((p) => p.id !== project.id);
      } else {
        trackContextSelect('project', project.id, 'select');
        return [...prev, project];
      }
    });
  };

  const isProjectSelected = (projectId: string) => {
    return selectedProjects.some((p) => p.id === projectId);
  };

  const clearSelection = () => {
    setSelectedProjects([]);
  };

  return (
    <SelectedProjectsContext.Provider
      value={{
        selectedProjects,
        toggleProject,
        isProjectSelected,
        clearSelection,
      }}
    >
      {children}
    </SelectedProjectsContext.Provider>
  );
}

export function useSelectedProjects() {
  const context = useContext(SelectedProjectsContext);
  if (context === undefined) {
    throw new Error("useSelectedProjects must be used within a SelectedProjectsProvider");
  }
  return context;
}

