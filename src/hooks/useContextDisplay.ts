import { useMemo } from "react";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
import { usePageContext } from "@/contexts/PageContext";
import { useSelectedTextContext } from "@/contexts/SelectedTextContext";
import { trackContextRemove } from "@/lib/analytics";
import type { Project } from "@/data/projectsData";
import type { Task } from "@/data/tasksData";
import type { Doc } from "@/data/docsData";
import type { PageContextType, PageContextRef } from "@/contexts/PageContext";
import type { TextSelectionPosition } from "@/hooks/useTextSelection";

export interface ContextDisplayData {
  // Context data
  selectedProjects: Project[];
  selectedTasks: Task[];
  selectedDocs: Doc[];
  implicitContextString: string | undefined;
  selectedText: { id: string; text: string; docId?: string } | null;
  selectedTextPosition: TextSelectionPosition | null;

  // Handlers
  onRemoveProject: (project: Project) => void;
  onRemoveTask: (task: Task) => void;
  onRemoveDoc: (doc: Doc) => void;
  onRemoveImplicitContext: () => void;
  onRemoveSelectedText: () => void;

  // Helper booleans
  hasSelectedContexts: boolean;
  hasSelectedText: boolean;
  hasImplicitContext: boolean;
  hasAnyContext: boolean;

  // Raw context refs (needed for AIChat's buildCitedContext)
  contextType: PageContextType | undefined;
  contextRef: PageContextRef | null;
}

export function useContextDisplay(): ContextDisplayData {
  // Get all context hooks
  const { selectedProjects, toggleProject } = useSelectedProjects();
  const { selectedTasks, toggleTask } = useSelectedTasks();
  const { selectedDocs, toggleDoc } = useSelectedDocs();
  const { contextType, contextRef, clearContext } = usePageContext();
  const { selectedTextPosition, clearSelectedText } = useSelectedTextContext();

  // Build implicit context string (same logic as AIChat lines 48-51)
  const implicitContextString = useMemo(() => {
    if (!contextType || !contextRef) return undefined;
    return `Current ${contextType}: ${contextRef.title} (ID: ${contextRef.id})`;
  }, [contextType, contextRef]);

  // Build selected text object with truncation (same logic from AIChat lines 1117-1126)
  const selectedText = useMemo(() => {
    if (!selectedTextPosition?.text) return null;

    return {
      id: `selected-text-${selectedTextPosition.docId}-${selectedTextPosition.startOffset}`,
      // Show preview in UI (truncate to 100 chars), but full text is sent to API via selectedTextPosition
      text: selectedTextPosition.text.length > 100
        ? selectedTextPosition.text.substring(0, 100) + '...'
        : selectedTextPosition.text,
      docId: selectedTextPosition.docId,
    };
  }, [selectedTextPosition]);

  // Helper booleans
  const hasSelectedContexts = selectedProjects.length > 0 || selectedTasks.length > 0 || selectedDocs.length > 0;
  const hasSelectedText = !!selectedTextPosition?.text;
  const hasImplicitContext = !!contextRef && !!contextType;
  const hasAnyContext = hasSelectedContexts || hasImplicitContext || hasSelectedText;

  // Handlers with analytics tracking
  const onRemoveProject = (project: Project) => {
    trackContextRemove('project', project.id);
    toggleProject(project);
  };

  const onRemoveTask = (task: Task) => {
    trackContextRemove('task', task.id);
    toggleTask(task);
  };

  const onRemoveDoc = (doc: Doc) => {
    trackContextRemove('doc', doc.id);
    toggleDoc(doc);
  };

  const onRemoveImplicitContext = () => {
    trackContextRemove('implicit-context', contextRef?.id || '');
    clearContext();
  };

  const onRemoveSelectedText = () => {
    trackContextRemove('selected-text', selectedTextPosition?.docId || '');
    clearSelectedText();
  };

  return {
    // Context data
    selectedProjects,
    selectedTasks,
    selectedDocs,
    implicitContextString,
    selectedText,
    selectedTextPosition,

    // Handlers
    onRemoveProject,
    onRemoveTask,
    onRemoveDoc,
    onRemoveImplicitContext,
    onRemoveSelectedText,

    // Helper booleans
    hasSelectedContexts,
    hasSelectedText,
    hasImplicitContext,
    hasAnyContext,

    // Raw context refs
    contextType,
    contextRef,
  };
}