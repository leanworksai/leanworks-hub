import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type PageContextType = 'project' | 'task' | 'doc' | 'team-chat' | null;

export interface PageContextRef {
  id: string;
  title: string;
}

interface PageContextValue {
  contextType: PageContextType;
  contextRef: PageContextRef | null;
  setContext: (type: PageContextType, ref: PageContextRef | null) => void;
  clearContext: () => void;
}

const PageContext = createContext<PageContextValue | undefined>(undefined);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [contextType, setContextType] = useState<PageContextType>(null);
  const [contextRef, setContextRef] = useState<PageContextRef | null>(null);

  const setContext = useCallback((type: PageContextType, ref: PageContextRef | null) => {
    setContextType(type);
    setContextRef(ref);
  }, []);

  const clearContext = useCallback(() => {
    setContextType(null);
    setContextRef(null);
  }, []);

  return (
    <PageContext.Provider value={{ contextType, contextRef, setContext, clearContext }}>
      {children}
    </PageContext.Provider>
  );
}

export function usePageContext() {
  const context = useContext(PageContext);
  if (context === undefined) {
    throw new Error('usePageContext must be used within a PageContextProvider');
  }
  return context;
}
