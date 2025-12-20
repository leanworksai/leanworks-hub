import { createContext, useContext, useState, ReactNode } from "react";
import { Doc } from "@/data/docsData";
import { trackContextSelect } from "@/lib/analytics";

interface SelectedDocsContextType {
  selectedDocs: Doc[];
  toggleDoc: (doc: Doc) => void;
  isDocSelected: (docId: string) => boolean;
  clearSelection: () => void;
}

const SelectedDocsContext = createContext<SelectedDocsContextType | undefined>(undefined);

export function SelectedDocsProvider({ children }: { children: ReactNode }) {
  const [selectedDocs, setSelectedDocs] = useState<Doc[]>([]);

  const toggleDoc = (doc: Doc) => {
    setSelectedDocs((prev) => {
      const isSelected = prev.some((d) => d.id === doc.id);
      if (isSelected) {
        trackContextSelect('doc', doc.id, 'deselect');
        return prev.filter((d) => d.id !== doc.id);
      } else {
        trackContextSelect('doc', doc.id, 'select');
        return [...prev, doc];
      }
    });
  };

  const isDocSelected = (docId: string) => {
    return selectedDocs.some((d) => d.id === docId);
  };

  const clearSelection = () => {
    setSelectedDocs([]);
  };

  return (
    <SelectedDocsContext.Provider
      value={{
        selectedDocs,
        toggleDoc,
        isDocSelected,
        clearSelection,
      }}
    >
      {children}
    </SelectedDocsContext.Provider>
  );
}

export function useSelectedDocs() {
  const context = useContext(SelectedDocsContext);
  if (context === undefined) {
    throw new Error("useSelectedDocs must be used within a SelectedDocsProvider");
  }
  return context;
}

