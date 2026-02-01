import { Button } from "@/components/ui/button";
import { MoreVertical, Share2, Mail, Paperclip, Trash2, Plus, X, Folder, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
import { useDocs, useUpdateDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import type { Doc } from "@/data/docsData";

interface DocItemMenuProps {
  doc: Doc;
  isActive: boolean;
  isOwner: boolean;
  filesCount: number;
  onDelete: (e: React.MouseEvent) => void;
}

export function DocItemMenu({
  doc,
  isActive,
  isOwner,
  filesCount,
  onDelete,
}: DocItemMenuProps) {
  const navigate = useNavigate();
  const { toggleDoc, isDocSelected } = useSelectedDocs();
  const { data: allDocs = [] } = useDocs();
  const updateDoc = useUpdateDoc();
  const { toast } = useToast();
  const isSelected = isDocSelected(doc.id);

  // Get available folders (excluding the current doc and its descendants)
  const availableFolders = allDocs.filter(d => {
    if (!d.isFolder) return false;
    if (d.id === doc.id) return false; // Can't move into itself

    // Check if this folder is a descendant of the current doc (if current doc is a folder)
    if (doc.isFolder) {
      let currentFolderId = d.folderId;
      while (currentFolderId) {
        if (currentFolderId === doc.id) return false;
        const parentFolder = allDocs.find(fd => fd.id === currentFolderId);
        currentFolderId = parentFolder?.folderId || null;
      }
    }

    return true;
  });

  const handleMoveToFolder = async (targetFolderId: string | null) => {
    try {
      await updateDoc.mutateAsync({
        docId: doc.id,
        updates: { folderId: targetFolderId }
      });

      const targetName = targetFolderId === null
        ? "root level"
        : (availableFolders.find(f => f.id === targetFolderId)?.title || "selected folder");

      toast({
        title: "Item moved",
        description: `Item moved to ${targetName} successfully.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to move item",
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 w-6 p-0 invisible group-hover:visible flex-shrink-0",
            isActive && "visible"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={(e) => {
          e.stopPropagation();
          toggleDoc(doc);
        }}>
          {isSelected ? (
            <>
              <X className="mr-2 h-4 w-4" />
              Remove from Context
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add to Context
            </>
          )}
        </DropdownMenuItem>
        {isOwner && (
          <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}?action=share`)}>
            <Share2 className="mr-2 h-4 w-4" />
            Limit Visibility
          </DropdownMenuItem>
        )}
        {isOwner && (
          <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}?action=shareEmail`)}>
            <Mail className="mr-2 h-4 w-4" />
            Share
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}?action=files`)}>
          <Paperclip className="mr-2 h-4 w-4" />
          Attached Files {filesCount > 0 && `(${filesCount})`}
        </DropdownMenuItem>

        {/* Move to folder sub-menu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Folder className="mr-2 h-4 w-4" />
            Move to folder
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => handleMoveToFolder(null)}>
              <Home className="mr-2 h-4 w-4" />
              Move to root
            </DropdownMenuItem>
            {availableFolders.length > 0 && <DropdownMenuSeparator />}
            {availableFolders.map(folder => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() => handleMoveToFolder(folder.id)}
              >
                <Folder className="mr-2 h-4 w-4" />
                {folder.title || "Untitled Folder"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {isOwner && (
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
