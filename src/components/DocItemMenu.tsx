import { Button } from "@/components/ui/button";
import { MoreVertical, Share2, Mail, Paperclip, Trash2, Plus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
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
  const isSelected = isDocSelected(doc.id);

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
