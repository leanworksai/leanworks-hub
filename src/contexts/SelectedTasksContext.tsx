import { createContext, useContext, useState, ReactNode } from "react";
import { Task } from "@/data/tasksData";
import { trackContextSelect } from "@/lib/analytics";

interface SelectedTasksContextType {
  selectedTasks: Task[];
  toggleTask: (task: Task) => void;
  isTaskSelected: (taskId: string) => boolean;
  clearSelection: () => void;
}

const SelectedTasksContext = createContext<SelectedTasksContextType | undefined>(undefined);

export function SelectedTasksProvider({ children }: { children: ReactNode }) {
  const [selectedTasks, setSelectedTasks] = useState<Task[]>([]);

  const toggleTask = (task: Task) => {
    setSelectedTasks((prev) => {
      const isSelected = prev.some((t) => t.id === task.id);
      if (isSelected) {
        trackContextSelect('task', task.id, 'deselect');
        return prev.filter((t) => t.id !== task.id);
      } else {
        trackContextSelect('task', task.id, 'select');
        return [...prev, task];
      }
    });
  };

  const isTaskSelected = (taskId: string) => {
    return selectedTasks.some((t) => t.id === taskId);
  };

  const clearSelection = () => {
    setSelectedTasks([]);
  };

  return (
    <SelectedTasksContext.Provider
      value={{
        selectedTasks,
        toggleTask,
        isTaskSelected,
        clearSelection,
      }}
    >
      {children}
    </SelectedTasksContext.Provider>
  );
}

export function useSelectedTasks() {
  const context = useContext(SelectedTasksContext);
  if (context === undefined) {
    throw new Error("useSelectedTasks must be used within a SelectedTasksProvider");
  }
  return context;
}

