import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FileText, Clock, AlertCircle } from 'lucide-react';
import type { DraftData } from '@/services/draftService';

interface DraftRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftData | null;
  serverUpdatedAt?: string;
  onRestore: () => void;
  onDiscard: () => void;
  onUseServer: () => void;
}

export function DraftRecoveryDialog({
  open,
  onOpenChange,
  draft,
  serverUpdatedAt,
  onRestore,
  onDiscard,
  onUseServer,
}: DraftRecoveryDialogProps) {
  if (!draft) return null;

  const draftDate = new Date(draft.timestamp);
  const serverDate = serverUpdatedAt ? new Date(serverUpdatedAt) : null;
  const isDraftNewer = !serverDate || draftDate > serverDate;

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const getContentPreview = (content: string) => {
    // Strip HTML tags and get first 100 characters
    const text = content.replace(/<[^>]*>/g, '').trim();
    return text.length > 100 ? text.substring(0, 100) + '...' : text;
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-5 w-5 text-primary" />
            <AlertDialogTitle>Recover Draft?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-3">
            <p>
              We found a saved draft for this document. Would you like to restore it?
            </p>

            <div className="space-y-2 p-3 bg-muted rounded-lg">
              <div className="flex items-start gap-2">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Draft saved</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(draftDate)}
                  </p>
                </div>
              </div>

              {serverDate && (
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Server version</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(serverDate)}
                    </p>
                  </div>
                </div>
              )}

              {!isDraftNewer && serverDate && (
                <div className="flex items-start gap-2 pt-1">
                  <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5" />
                  <p className="text-xs text-amber-600">
                    The server version is newer than your draft.
                  </p>
                </div>
              )}
            </div>

            {draft.title && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Draft Title:</p>
                <p className="text-sm text-muted-foreground">{draft.title || 'Untitled'}</p>
              </div>
            )}

            {draft.content && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Preview:</p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {getContentPreview(draft.content)}
                </p>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={onDiscard}>
            Discard Draft
          </AlertDialogCancel>
          {serverDate && (
            <AlertDialogAction
              onClick={onUseServer}
              className="order-2 sm:order-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              Use Server Version
            </AlertDialogAction>
          )}
          <AlertDialogAction
            onClick={onRestore}
            className="order-1 sm:order-2"
          >
            Restore Draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

