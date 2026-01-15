import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowLeft, MoreVertical, Share2, Mail, Paperclip, Trash2 } from 'lucide-react';

interface DocToolbarProps {
  onBack: () => void;
  onShare: () => void;
  onShareViaEmail: () => void;
  onAttachedFiles: () => void;
  onDelete: () => void;
  isOwner: boolean;
  filesCount: number;
  isNew: boolean;
}

// Memoized BackButton - only re-renders when onClick changes
const BackButton = memo(function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button 
      variant="ghost" 
      size="sm" 
      onClick={onClick}
      className="hover:bg-muted/50"
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
});

// Memoized MoreActionsMenu - only re-renders when props change
const MoreActionsMenu = memo(function MoreActionsMenu({
  onShare,
  onShareViaEmail,
  onAttachedFiles,
  onDelete,
  isOwner,
  filesCount
}: {
  onShare: () => void;
  onShareViaEmail: () => void;
  onAttachedFiles: () => void;
  onDelete: () => void;
  isOwner: boolean;
  filesCount: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isOwner && (
          <DropdownMenuItem onClick={onShare}>
            <Share2 className="mr-2 h-4 w-4" />
            Limit Visibility
          </DropdownMenuItem>
        )}
        {isOwner && (
          <DropdownMenuItem onClick={onShareViaEmail}>
            <Mail className="mr-2 h-4 w-4" />
            Share
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onAttachedFiles}>
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
});

// Main DocToolbar component - fully memoized with custom comparison
export const DocToolbar = memo(function DocToolbar({
  onBack,
  onShare,
  onShareViaEmail,
  onAttachedFiles,
  onDelete,
  isOwner,
  filesCount,
  isNew,
}: DocToolbarProps) {
  return (
    <div className="flex items-center justify-end w-full flex-shrink-0">
      {/* 3 dots menu removed from content page */}
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if props that affect rendering changed
  return (
    prevProps.onBack === nextProps.onBack &&
    prevProps.onShare === nextProps.onShare &&
    prevProps.onShareViaEmail === nextProps.onShareViaEmail &&
    prevProps.onAttachedFiles === nextProps.onAttachedFiles &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.isOwner === nextProps.isOwner &&
    prevProps.filesCount === nextProps.filesCount &&
    prevProps.isNew === nextProps.isNew
  );
});
