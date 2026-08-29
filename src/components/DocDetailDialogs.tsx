import { Button } from "@/components/ui/button";
import { Download, File, Paperclip, Trash2 } from "lucide-react";
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
import { formatFileSize } from "@/utils/docUtils";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import type { DocFile } from "@/data/docsData";
import type { Doc } from "@/data/docsData";
import type { UseDocDialogsReturn } from "@/hooks/useDocDialogs";
import type { DocFormState } from "@/hooks/useDocForm";
import type { UseMutationResult } from "@tanstack/react-query";

interface DocDetailDialogsProps {
  dialogs: UseDocDialogsReturn;
  files: DocFile[];
  fileToDelete: DocFile | null;
  setFileToDelete: (file: DocFile | null) => void;
  handleRemoveFile: () => Promise<void>;
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
  files,
  fileToDelete,
  setFileToDelete,
  handleRemoveFile,
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
      {/* Attached Files Dialog */}
      <Dialog
        open={dialogs.filesDialogOpen}
        onOpenChange={(open) =>
          open ? dialogs.openDialog("files") : dialogs.closeDialog()
        }
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attached Files</DialogTitle>
          </DialogHeader>
          {files.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Paperclip className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No files attached to this document.</p>
            </div>
          ) : (
            <div className="space-y-2 mt-4">
              {files.map((file) => (
                <div
                  key={file.fileId}
                  className="flex items-center justify-between p-3 border border-border/30 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <File className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={file.fileName}>
                        {file.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.fileSize)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(file.fileUrl, "_blank")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                    {!isNew && doc && isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFileToDelete(file)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete File Confirmation Dialog */}
      <AlertDialog
        open={!!fileToDelete}
        onOpenChange={(open) => !open && setFileToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{fileToDelete?.fileName}" from
              this document? This will remove the file reference, but the file
              will remain in storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveFile}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
