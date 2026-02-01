import { Button } from "@/components/ui/button";
import { Plus, FileText, Upload, Folder } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDocs, useCreateDoc, useUpdateDoc } from "@/hooks/useDocs";
import { trackClick, trackView } from "@/lib/analytics";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { isDocOwner } from "@/utils/docUtils";
import { useDeleteDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { DocItem, type DocItemProps } from "./DocItem";
import { DocumentUploadDialog } from "./DocumentUploadDialog";
import { NewFolderDialog } from "./NewFolderDialog";
import type { Doc } from "@/data/docsData";
import { v4 as uuidv4 } from "uuid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useMemo } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type DocsListVariant = "sidebar" | "catalog";

// Draggable version of DocItem
function DraggableDocItem({
  doc,
  isActive,
  isOwner,
  title,
  onDocClick,
  onDelete,
  isExpanded,
  hasChildren,
  level,
}: DocItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: doc.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-50")}
      {...attributes}
      {...listeners}
    >
      <DocItem
        doc={doc}
        isActive={isActive}
        isOwner={isOwner}
        title={title}
        onDocClick={onDocClick}
        onDelete={onDelete}
        isExpanded={isExpanded}
        hasChildren={hasChildren}
        level={level}
      />
    </div>
  );
}

interface DocsListProps {
  variant?: DocsListVariant;
}

export function DocsList({ variant = "sidebar" }: DocsListProps) {
  const navigate = useNavigate();
  const { docId: activeDocId } = useParams<{ docId: string }>();
  const { data: docs = [], isLoading } = useDocs();
  const { user } = useAuth();
  const deleteDoc = useDeleteDoc();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const { toast } = useToast();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<Doc | null>(null);

  // Set up sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
      },
    })
  );

  // Sort docs by created at desc (newest first)
  const sortedDocs = [...docs].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Transform flat docs into hierarchical tree structure
  const docsTree = useMemo(() => {
    const rootItems: Doc[] = [];
    const folderChildren = new Map<string, Doc[]>();

    // First pass: organize docs by folder
    sortedDocs.forEach(doc => {
      const folderId = doc.folderId || null;
      if (folderId === null) {
        // Root level items (folders and documents not in any folder)
        rootItems.push(doc);
      } else {
        // Items inside folders
        if (!folderChildren.has(folderId)) {
          folderChildren.set(folderId, []);
        }
        folderChildren.get(folderId)!.push(doc);
      }
    });

    // Second pass: build hierarchical structure
    const buildHierarchy = (items: Doc[]): Doc[] => {
      return items.map(item => {
        if (item.isFolder) {
          const children = folderChildren.get(item.id) || [];
          // Sort children: folders first, then documents
          const sortedChildren = children.sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            // Within same type, sort by created date desc
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });

          return {
            ...item,
            children: sortedChildren
          };
        }
        return item;
      });
    };

    // Sort root items: folders first, then documents
    const sortedRootItems = rootItems.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      // Within same type, sort by created date desc
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return buildHierarchy(sortedRootItems);
  }, [sortedDocs]);

  // Function to toggle folder expansion
  const toggleFolderExpansion = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  // Drag event handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedDoc = docs.find(doc => doc.id === active.id);
    setDraggedItem(draggedDoc || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedItem(null);

    if (!over) return;

    const draggedDocId = active.id as string;
    const targetId = over.id as string;

    // Don't do anything if dropped on itself
    if (draggedDocId === targetId) return;

    const draggedDoc = docs.find(doc => doc.id === draggedDocId);
    if (!draggedDoc) return;

    // Check if dropped on a folder
    const targetDoc = docs.find(doc => doc.id === targetId);
    if (!targetDoc || !targetDoc.isFolder) {
      // If not dropped on a folder, move to root level
      if (draggedDoc.folderId !== null) {
        try {
          await updateDoc.mutateAsync({
            docId: draggedDocId,
            updates: { folderId: null }
          });
          toast({
            title: "Item moved",
            description: "Item moved to root level successfully.",
          });
        } catch (error) {
          toast({
            title: "Error",
            description: error instanceof Error ? error.message : "Failed to move item",
            variant: "destructive",
          });
        }
      }
      return;
    }

    // Prevent moving a folder into itself or its descendants
    if (draggedDoc.isFolder) {
      let currentFolderId = targetDoc.folderId;
      while (currentFolderId) {
        if (currentFolderId === draggedDocId) {
          toast({
            title: "Invalid move",
            description: "Cannot move a folder into itself or its subfolders.",
            variant: "destructive",
          });
          return;
        }
        const parentFolder = docs.find(doc => doc.id === currentFolderId);
        currentFolderId = parentFolder?.folderId || null;
      }
    }

    // Move item into the target folder
    try {
      await updateDoc.mutateAsync({
        docId: draggedDocId,
        updates: { folderId: targetId }
      });

      // Auto-expand the target folder
      setExpandedFolders(prev => new Set([...prev, targetId]));

      toast({
        title: "Item moved",
        description: `Item moved to "${targetDoc.title || 'Untitled Folder'}" successfully.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to move item",
        variant: "destructive",
      });
    }
  };

  // Recursive function to render the doc tree
  const renderDocTree = (items: Doc[], level = 0): JSX.Element[] => {
    return items.flatMap((doc) => {
      const isActive = doc.id === activeDocId;
      const isExpanded = expandedFolders.has(doc.id);
      const hasChildren = doc.isFolder && (doc as any).children && (doc as any).children.length > 0;

      // For folders, use title directly. For uploaded files, use doc.title directly. For rich_text, extract from content.
      const docType = doc.docType || 'rich_text';
      const title = doc.isFolder
        ? (doc.title || "Untitled Folder")
        : docType !== 'rich_text'
        ? (doc.title || "Untitled")
        : (extractFirstLineAsTitle(doc.content || doc.title || "", 50) || "Untitled");
      const docIsOwner = isDocOwner(user?.email, doc.ownerEmail);

      const elements: JSX.Element[] = [];

      // Render the current item
      elements.push(
        <DraggableDocItem
          key={doc.id}
          doc={doc}
          isActive={isActive}
          isOwner={docIsOwner}
          title={title}
          onDocClick={(docId) => {
            if (doc.isFolder) {
              // Toggle folder expansion instead of navigating
              toggleFolderExpansion(docId);
            } else {
              handleDocClick(docId);
            }
          }}
          onDelete={(e) => performDeleteDoc(doc, e)}
          isExpanded={isExpanded}
          hasChildren={hasChildren}
          level={level}
        />
      );

      // Render children if folder is expanded
      if (doc.isFolder && isExpanded && (doc as any).children) {
        elements.push(...renderDocTree((doc as any).children, level + 1));
      }

      return elements;
    });
  };

  const handleCreateDoc = async () => {
    trackClick('create_doc', '/docs');

    if (!user?.email) {
      toast({
        title: "Error",
        description: "You must be logged in to create a document",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create the doc immediately with empty content and "Untitled" title
      // Use default TipTap empty structure for valid JSON
      const emptyTipTapContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
      const newDoc: Doc = {
        id: uuidv4(),
        title: "Untitled",
        content: emptyTipTapContent,
        ownerEmail: user.email,
        projectId: null,
        teamId: null,
        folderId: null,
        isFolder: false,
        visibility: 'all_members',
        visibleToMembers: [],
        metadata: { files: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const createdDoc = await createDoc.mutateAsync(newDoc);

      // Navigate to the created doc
      navigate(`/docs/${createdDoc.id}`);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create document",
        variant: "destructive",
      });
    }
  };

  const handleCreateFolder = async (folderName: string) => {
    trackClick('create_folder', '/docs');

    if (!user?.email) {
      toast({
        title: "Error",
        description: "You must be logged in to create a folder",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create the folder with user-provided name and empty content
      const newFolder: Doc = {
        id: uuidv4(),
        title: folderName,
        content: '{}', // Folders have empty content
        ownerEmail: user.email,
        projectId: null,
        teamId: null,
        folderId: null,
        isFolder: true,
        visibility: 'all_members',
        visibleToMembers: [],
        metadata: { files: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const createdFolder = await createDoc.mutateAsync(newFolder);

      toast({
        title: "Folder created",
        description: `Folder "${folderName}" has been created successfully.`,
      });

      // Don't navigate to folders - they don't have a detail view
      // The folder will appear in the list immediately due to optimistic updates
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create folder",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleDocClick = (docId: string) => {
    trackView('doc', docId);
    navigate(`/docs/${docId}`);
  };

  const performDeleteDoc = async (doc: typeof docs[0], e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking delete
    // For folders, use title directly. For uploaded files, use doc.title directly. For rich_text, extract from content.
    const docType = doc.docType || 'rich_text';
    const docTitle = doc.isFolder
      ? (doc.title || "this folder")
      : docType !== 'rich_text' 
      ? (doc.title || "this doc")
      : (extractFirstLineAsTitle(doc.content || doc.title || "", 50) || "this doc");
    if (window.confirm(`Are you sure you want to delete "${docTitle}"?`)) {
      try {
        await deleteDoc.mutateAsync(doc.id);
        toast({
          title: "Doc deleted",
          description: "Document has been deleted successfully.",
        });
      } catch (error) {
        toast({
          title: "Error",
          description:
            error instanceof Error ? error.message : "Failed to delete doc",
          variant: "destructive",
        });
      }
    }
  };

  if (isLoading) {
    if (variant === "sidebar") {
      return (
        <div className="w-64 border-r border-border bg-card/50 p-4 space-y-4 flex flex-col">
          <div className="h-8 bg-muted/50 rounded animate-pulse" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full p-4">
        <div className="h-8 bg-muted/50 rounded animate-pulse mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <div className="w-64 border-r border-border bg-card/30 flex flex-col h-full flex-shrink-0 hidden md:flex">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Docs</h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleCreateDoc}>
                  <FileText className="h-4 w-4 mr-2" />
                  Create a blank page
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setNewFolderDialogOpen(true)}>
                  <Folder className="h-4 w-4 mr-2" />
                  Create folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUploadDialogOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload a file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <DocumentUploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
        />

        <NewFolderDialog
          open={newFolderDialogOpen}
          onOpenChange={setNewFolderDialogOpen}
          onCreateFolder={handleCreateFolder}
        />

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            {docs.length === 0 ? (
              <div className="text-center py-8 px-4">
                <p className="text-sm text-muted-foreground mb-4">No docs yet</p>
              </div>
            ) : (
              renderDocTree(docsTree)
            )}
          </div>

          <DragOverlay>
            {draggedItem ? (
              <div className="bg-background border border-border rounded-md shadow-lg opacity-90">
                <DocItem
                  doc={draggedItem}
                  isActive={false}
                  isOwner={false}
                  title={
                    draggedItem.isFolder
                      ? (draggedItem.title || "Untitled Folder")
                      : draggedItem.docType !== 'rich_text'
                      ? (draggedItem.title || "Untitled")
                      : (extractFirstLineAsTitle(draggedItem.content || draggedItem.title || "", 50) || "Untitled")
                  }
                  onDocClick={() => {}}
                  onDelete={() => {}}
                  isExpanded={false}
                  hasChildren={false}
                  level={0}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    );
  }

  // Catalog variant
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-1.5 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Docs</h2>
          <Button 
            size="sm" 
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={handleCreateDoc}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {docs.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-muted-foreground mb-4">No docs yet</p>
          </div>
        ) : (
          sortedDocs.map((doc) => {
            const isActive = doc.id === activeDocId;
            // For folders, use title directly. For uploaded files, use doc.title directly. For rich_text, extract from content.
            const docType = doc.docType || 'rich_text';
            const title = doc.isFolder
              ? (doc.title || "Untitled Folder")
              : docType !== 'rich_text'
              ? (doc.title || "Untitled")
              : (extractFirstLineAsTitle(doc.content || doc.title || "", 50) || "Untitled");
            const docIsOwner = isDocOwner(user?.email, doc.ownerEmail);

            return (
              <DocItem
                key={doc.id}
                doc={doc}
                isActive={isActive}
                isOwner={docIsOwner}
                title={title}
                onDocClick={handleDocClick}
                onDelete={(e) => performDeleteDoc(doc, e)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
