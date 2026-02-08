import { Button } from "@/components/ui/button";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { ShareDocDialog } from "@/components/ShareDocDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import type { Doc } from "@/data/docsData";
import type { UseDocDialogsReturn } from "@/hooks/useDocDialogs";
import type { DocFormState } from "@/hooks/useDocForm";
import type { UseMutationResult } from "@tanstack/react-query";

interface DocDetailDialogsProps {
  dialogs: UseDocDialogsReturn;
  doc: Doc | null | undefined;
  isNew: boolean;
  isOwner: boolean;
  formState: DocFormState;
  updateField: <K extends keyof DocFormState>(
    field: K,
    value: DocFormState[K]
  ) => void;
  updateDoc: UseMutationResult<any, Error, any, unknown>;
  handleDelete: () => Promise<void>;
  toast: (options: {
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  }) => void;
}

export function DocDetailDialogs({
  dialogs,
  doc,
  isNew,
  isOwner,
  formState,
  updateField,
  updateDoc,
  handleDelete,
  toast,
}: DocDetailDialogsProps) {
  return (
    <>
      {/* Delete Doc Confirmation Dialog */}
      <AlertDialog
        open={dialogs.deleteDialogOpen}
        onOpenChange={(open) =>
          open ? dialogs.openDialog("delete") : dialogs.closeDialog()
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "
              {(() => {
                // For uploaded files, use doc.title directly. For rich_text, extract from content.
                const docType = doc?.docType || 'rich_text';
                if (docType !== 'rich_text') {
                  return doc?.title || "this document";
                }
                return extractFirstLineAsTitle(doc?.content || "", 100) || "this document";
              })()}
              "? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Limit Visibility Dialog */}
      {!isNew && doc && (
        <LimitVisibilityDialog
          open={dialogs.shareDialogOpen}
          onOpenChange={(open) =>
            open ? dialogs.openDialog("share") : dialogs.closeDialog()
          }
          title="Limit Document Visibility"
          itemName={
            (() => {
              // For uploaded files, use doc.title directly. For rich_text, extract from content.
              const docType = doc.docType || 'rich_text';
              if (docType !== 'rich_text') {
                return doc.title || "Document";
              }
              return extractFirstLineAsTitle(doc.content || "", 100) || "Document";
            })()
          }
          currentVisibility={formState.visibility}
          currentVisibleToMembers={formState.visibleToMembers}
          onSave={async (newVisibility, newVisibleToMembers) => {
            updateField("visibility", newVisibility);
            // Ensure newVisibleToMembers is always an array
            const membersArray = Array.isArray(newVisibleToMembers)
              ? newVisibleToMembers
              : [];
            updateField("visibleToMembers", membersArray);
            await updateDoc.mutateAsync({
              docId: doc.id,
              updates: {
                visibility: newVisibility,
                visibleToMembers: membersArray,
              },
            });
            toast({
              title: "Visibility updated",
              description:
                "Document visibility has been updated successfully.",
            });
          }}
        />
      )}

      {/* Share Document Dialog */}
      {!isNew && doc && (
        <ShareDocDialog
          open={dialogs.shareViaEmailDialogOpen}
          onOpenChange={(open) =>
            open ? dialogs.openDialog("shareViaEmail") : dialogs.closeDialog()
          }
          docId={doc.id}
          docTitle={
            (() => {
              // For uploaded files, use doc.title directly. For rich_text, extract from content.
              const docType = doc.docType || 'rich_text';
              if (docType !== 'rich_text') {
                return doc.title || "Document";
              }
              return extractFirstLineAsTitle(doc.content || "", 100) || "Document";
            })()
          }
        />
      )}
    </>
  );
}
