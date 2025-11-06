import { createContext, useContext, useState, ReactNode } from "react";

interface SelectionModeContextType {
  isSelectionMode: boolean;
  toggleSelectionMode: () => void;
  setSelectionMode: (enabled: boolean) => void;
}

const SelectionModeContext = createContext<SelectionModeContextType | undefined>(undefined);

export function SelectionModeProvider({ children }: { children: ReactNode }) {
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const toggleSelectionMode = () => {
    setIsSelectionMode((prev) => !prev);
  };

  const setSelectionMode = (enabled: boolean) => {
    setIsSelectionMode(enabled);
  };

  return (
    <SelectionModeContext.Provider
      value={{
        isSelectionMode,
        toggleSelectionMode,
        setSelectionMode,
      }}
    >
      {children}
    </SelectionModeContext.Provider>
  );
}

export function useSelectionMode() {
  const context = useContext(SelectionModeContext);
  if (context === undefined) {
    throw new Error("useSelectionMode must be used within a SelectionModeProvider");
  }
  return context;
}

