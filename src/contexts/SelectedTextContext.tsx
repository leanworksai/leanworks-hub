import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { TextSelectionPosition } from "@/hooks/useTextSelection";

interface SelectedTextContextValue {
  selectedTextPosition: TextSelectionPosition | null;
  setSelectedTextPosition: (position: TextSelectionPosition | null) => void;
  clearSelectedText: () => void;
}

const SelectedTextContext = createContext<SelectedTextContextValue | undefined>(undefined);

export function SelectedTextContextProvider({ children }: { children: ReactNode }) {
  const [selectedTextPosition, setSelectedTextPositionState] = useState<TextSelectionPosition | null>(null);

  const setSelectedTextPosition = useCallback((position: TextSelectionPosition | null) => {
    setSelectedTextPositionState(position);
  }, []);

  const clearSelectedText = useCallback(() => {
    setSelectedTextPositionState(null);
  }, []);

  return (
    <SelectedTextContext.Provider value={{ selectedTextPosition, setSelectedTextPosition, clearSelectedText }}>
      {children}
    </SelectedTextContext.Provider>
  );
}

export function useSelectedTextContext() {
  const context = useContext(SelectedTextContext);
  if (context === undefined) {
    throw new Error('useSelectedTextContext must be used within a SelectedTextContextProvider');
  }
  return context;
}
