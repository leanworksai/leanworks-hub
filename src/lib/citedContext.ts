import type { PageContextRef, PageContextType } from "@/contexts/PageContext";
import type { TextSelectionPosition } from "@/hooks/useTextSelection";

type AnyRecord = Record<string, any>;

interface BuildCitedContextInput {
  selectedProjects: AnyRecord[];
  selectedTasks: AnyRecord[];
  selectedDocs: AnyRecord[];
  selectedTextPosition?: TextSelectionPosition | null;
  contextType?: PageContextType;
  contextRef?: PageContextRef | null;
  includeImplicitDoc?: boolean;
}

function buildSelectedTexts(selectedTextPosition?: TextSelectionPosition | null) {
  if (!selectedTextPosition?.text) return undefined;
  const offset = selectedTextPosition.startOffset ?? selectedTextPosition.from ?? 0;
  return [{
    id: `selected-text-${selectedTextPosition.docId}-${offset}`,
    text: selectedTextPosition.text,
    docId: selectedTextPosition.docId,
  }];
}

function trimSelectedTextPosition(selectedTextPosition?: TextSelectionPosition | null) {
  if (!selectedTextPosition) return undefined;
  const { text: _text, ...rest } = selectedTextPosition;
  return rest;
}

export function buildCitedContext({
  selectedProjects,
  selectedTasks,
  selectedDocs,
  selectedTextPosition,
  contextType,
  contextRef,
  includeImplicitDoc = false,
}: BuildCitedContextInput) {
  let projects = selectedProjects;
  let tasks = selectedTasks;
  let docs = selectedDocs;

  // Debug logging (dev only)
  if (typeof window !== 'undefined' && (window as any).__DEV__) {
    console.log('🔍 [buildCitedContext] Input params:', {
      includeImplicitDoc,
      contextType,
      contextRef,
      selectedProjectsLen: selectedProjects.length,
      selectedTasksLen: selectedTasks.length,
      selectedDocsLen: selectedDocs.length,
      hasSelectedText: !!selectedTextPosition?.text,
    });
  }

  // Add implicit context if available (merge into appropriate array)
  if (includeImplicitDoc && contextRef && contextType) {
    if (contextType === "project") {
      const hasProject = projects.some((p) => p.id === contextRef.id);
      if (!hasProject) {
        projects = [...projects, { id: contextRef.id, title: contextRef.title }];
      }
    } else if (contextType === "task") {
      const hasTask = tasks.some((t) => t.id === contextRef.id);
      if (!hasTask) {
        tasks = [...tasks, { id: contextRef.id, title: contextRef.title }];
      }
    } else if (contextType === "doc") {
      const hasDoc = docs.some((doc) => doc.id === contextRef.id);
      if (!hasDoc) {
        docs = [...docs, { id: contextRef.id, title: contextRef.title }];
      }
    }
  }

  const selectedTexts = buildSelectedTexts(selectedTextPosition);
  const trimmedSelectedTextPosition = trimSelectedTextPosition(selectedTextPosition);

  const hasContext =
    projects.length > 0 ||
    tasks.length > 0 ||
    docs.length > 0 ||
    !!selectedTexts?.length ||
    !!trimmedSelectedTextPosition;

  if (!hasContext) return undefined;

  return {
    projects: projects.length > 0 ? [...projects] : undefined,
    tasks: tasks.length > 0 ? [...tasks] : undefined,
    docs: docs.length > 0 ? [...docs] : undefined,
    selectedTexts,
    selectedTextPosition: trimmedSelectedTextPosition,
  };
}
