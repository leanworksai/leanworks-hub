import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowLeft, MoreVertical, Share2, Mail, Paperclip, Trash2, FileText } from 'lucide-react';
import type { SaveStatus } from '@/hooks/useAutoSave';

interface DocToolbarProps {
  onBack: () => void;
  onSave: () => void;
  saveStatus: SaveStatus;
  onShare: () => void;
  onShareViaEmail: () => void;
  onAttachedFiles: () => void;
  onDelete: () => void;
  onFormatDocument?: () => void;
  isOwner: boolean;
  filesCount: number;
  isNew: boolean;
  isSaving: boolean;
}

// Memoized SaveButton - only re-renders when onClick or disabled changes
const SaveButton = memo(function SaveButton({ 
  onClick, 
  disabled 
}: { 
  onClick: () => void; 
  disabled: boolean; 
}) {
  return (
    <Button 
      variant="default" 
      size="sm" 
      onClick={onClick}
      disabled={disabled}
      className="bg-black text-white hover:bg-black/90"
    >
      Save
    </Button>
  );
}, (prevProps, nextProps) => {
  // Only re-render if onClick reference or disabled value actually changed
  return prevProps.onClick === nextProps.onClick && prevProps.disabled === nextProps.disabled;
});

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
  onFormatDocument,
  isOwner,
  filesCount
}: {
  onShare: () => void;
  onShareViaEmail: () => void;
  onAttachedFiles: () => void;
  onDelete: () => void;
  onFormatDocument?: () => void;
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
        {onFormatDocument && (
          <DropdownMenuItem onClick={onFormatDocument}>
            <FileText className="mr-2 h-4 w-4" />
            Format Document
          </DropdownMenuItem>
        )}
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
  onSave,
  saveStatus,
  onShare,
  onShareViaEmail,
  onAttachedFiles,
  onDelete,
  onFormatDocument,
  isOwner,
  filesCount,
  isNew,
  isSaving,
}: DocToolbarProps) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <BackButton onClick={onBack} />
      <div>
        <SaveButton onClick={onSave} disabled={isSaving} />
      </div>
      {!isNew && (
        <MoreActionsMenu
          onShare={onShare}
          onShareViaEmail={onShareViaEmail}
          onAttachedFiles={onAttachedFiles}
          onDelete={onDelete}
          onFormatDocument={onFormatDocument}
          isOwner={isOwner}
          filesCount={filesCount}
        />
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if props that affect rendering changed
  // CRITICAL: Ignore saveStatus changes if isSaving hasn't changed
  // This prevents re-renders when saveStatus transitions (saved->saving->saved)
  // but isSaving stays the same (false->true->false)
  return (
    prevProps.onBack === nextProps.onBack &&
    prevProps.onSave === nextProps.onSave &&
    // saveStatus comparison: only care if isSaving changed, not saveStatus transitions
    prevProps.isSaving === nextProps.isSaving &&
    prevProps.onShare === nextProps.onShare &&
    prevProps.onShareViaEmail === nextProps.onShareViaEmail &&
    prevProps.onAttachedFiles === nextProps.onAttachedFiles &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.isOwner === nextProps.isOwner &&
    prevProps.filesCount === nextProps.filesCount &&
    prevProps.isNew === nextProps.isNew
  );
});
