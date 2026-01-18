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
  let docs = selectedDocs;

  if (includeImplicitDoc && contextType === "doc" && contextRef) {
    const hasDoc = docs.some((doc) => doc.id === contextRef.id);
    if (!hasDoc) {
      docs = [...docs, { id: contextRef.id, title: contextRef.title }];
    }
  }

  const selectedTexts = buildSelectedTexts(selectedTextPosition);
  const trimmedSelectedTextPosition = trimSelectedTextPosition(selectedTextPosition);

  const hasContext =
    selectedProjects.length > 0 ||
    selectedTasks.length > 0 ||
    docs.length > 0 ||
    !!selectedTexts?.length ||
    !!trimmedSelectedTextPosition;

  if (!hasContext) return undefined;

  return {
    projects: selectedProjects.length > 0 ? [...selectedProjects] : undefined,
    tasks: selectedTasks.length > 0 ? [...selectedTasks] : undefined,
    docs: docs.length > 0 ? [...docs] : undefined,
    selectedTexts,
    selectedTextPosition: trimmedSelectedTextPosition,
  };
}
