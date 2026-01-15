import { Button } from "@/components/ui/button";
import { MoreVertical, Share2, Mail, Paperclip, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface DocItemMenuProps {
  docId: string;
  isActive: boolean;
  isOwner: boolean;
  filesCount: number;
  onDelete: (e: React.MouseEvent) => void;
}

export function DocItemMenu({
  docId,
  isActive,
  isOwner,
  filesCount,
  onDelete,
}: DocItemMenuProps) {
  const navigate = useNavigate();

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
        {isOwner && (
          <DropdownMenuItem onClick={() => navigate(`/docs/${docId}?action=share`)}>
            <Share2 className="mr-2 h-4 w-4" />
            Limit Visibility
          </DropdownMenuItem>
        )}
        {isOwner && (
          <DropdownMenuItem onClick={() => navigate(`/docs/${docId}?action=shareEmail`)}>
            <Mail className="mr-2 h-4 w-4" />
            Share
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => navigate(`/docs/${docId}?action=files`)}>
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
