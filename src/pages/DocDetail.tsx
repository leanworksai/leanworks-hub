import { useParams, useNavigate } from "react-router-dom";
import { memo, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useDoc, useUpdateDoc, useDeleteDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { Download, File, Paperclip, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { ShareDocDialog } from "@/components/ShareDocDialog";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { useAutoSave } from "@/hooks/useAutoSave";
import { trackEvent, trackView } from "@/lib/analytics";
import { initOfflineQueue } from "@/services/offlineQueue";
import { useScrollTracking } from "@/hooks/useScrollTracking";
import { usePageContext } from "@/contexts/PageContext";
import { DocToolbar } from "@/components/DocToolbar";
import { TitleWithToolbar } from "@/components/TitleWithToolbar";
import { useDocDialogs } from "@/hooks/useDocDialogs";
import { useDocFiles } from "@/hooks/useDocFiles";
import { useDocForm } from "@/hooks/useDocForm";
import { useManualSave } from "@/hooks/useManualSave";
import { isDocOwner, formatFileSize, createDocActions } from "@/utils/docUtils";
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

export default memo(function DocDetail() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const isNew = docId === "new";
  const { data: doc, isLoading } = useDoc(docId || "");
  const updateDoc = useUpdateDoc();
  const deleteDoc = useDeleteDoc();
  const { toast } = useToast();
  const { user } = useAuth();
  const { setContext, clearContext } = usePageContext();
  
  // Track scroll depth for engagement
  useScrollTracking(true);

  // Custom hooks for state management
  const dialogs = useDocDialogs();
  const { formState, updateField } = useDocForm({ initialDoc: doc, isNew });
  const { files, handleFileUpload, handleRemoveFile, fileToDelete, setFileToDelete } = useDocFiles({
    docId: docId || 'new',
    initialFiles: doc?.metadata?.files || [],
  });
  
  // Auto-save hook - always enabled since we're always in edit mode
  const autoSave = useAutoSave({
    docId: docId || 'new',
    title: formState.title,
    content: formState.content,
    visibility: formState.visibility,
    visibleToMembers: formState.visibleToMembers,
    files,
    enabled: true,
    onSaveSuccess: (savedDocId: string, isManual: boolean) => {
      // Track document save
      trackEvent('doc_saved', {
        doc_id: savedDocId,
        save_method: isManual ? 'manual' : 'auto',
      });
      
      // Track document edit if it's an existing doc
      if (docId !== 'new' && savedDocId) {
        trackEvent('doc_edited', {
          doc_id: savedDocId,
        });
      }
      
      // Show toast for manual saves
      if (isManual) {
        toast({
          title: "Saved",
          description: "Document has been saved successfully.",
        });
      }
    },
    onSaveError: (error) => {
      // Errors are handled by the hook's status
      console.error('Auto-save error:', error);
    },
  });

  // Manual save hook - handles UI feedback for manual saves
  // Must be defined after autoSave since it depends on it
  const { saveStatus, isSaving, handleSave } = useManualSave({
    onSave: () => autoSave.manualSave(),
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save document",
        variant: "destructive",
      });
    },
  });

  // Initialize offline queue monitoring
  useEffect(() => {
    const cleanup = initOfflineQueue();
    return cleanup;
  }, []);

  // Track document view
  useEffect(() => {
    if (docId && docId !== 'new' && doc) {
      trackView('doc', docId);
    }
  }, [docId, doc]);

  // Set page context when doc loads
  useEffect(() => {
    if (doc && docId && docId !== 'new' && doc.title) {
      setContext('doc', { id: docId, title: doc.title });
    } else {
      clearContext();
    }

    // Clear context on unmount
    return () => {
      clearContext();
    };
  }, [doc, docId, setContext, clearContext]);


  const handleDelete = useCallback(async () => {
    if (!docId || docId === "new") {
      return;
    }

    try {
      await deleteDoc.mutateAsync(docId);
      toast({
        title: "Doc deleted",
        description: `"${formState.title || doc?.title || 'Doc'}" has been deleted successfully.`,
      });
      navigate('/docs');
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete doc",
        variant: "destructive",
      });
    }
  }, [docId, deleteDoc, toast, navigate, formState.title, doc?.title]);

  // Memoized handlers - stable references to prevent DocToolbar re-renders
  const handleBack = useCallback(() => navigate("/docs"), [navigate]);
  const handleShare = useCallback(() => dialogs.openDialog('share'), [dialogs.openDialog]);
  const handleShareViaEmail = useCallback(() => dialogs.openDialog('shareViaEmail'), [dialogs.openDialog]);
  const handleAttachedFiles = useCallback(() => dialogs.openDialog('files'), [dialogs.openDialog]);
  const openDeleteDialog = useCallback(() => dialogs.openDialog('delete'), [dialogs.openDialog]);

  // Format document handler - applies text wrapping to entire document
  const handleFormatDocument = useCallback(() => {
    // This would apply formatting to the entire document content
    // For now, we'll trigger a re-render that might help with wrapping
    // In a full implementation, this would analyze and reformat the entire document
    console.log('Format document requested - applying text wrapping fixes');
    // Force a content update to trigger any pending wrapping
    updateField('content', formState.content);
  }, [formState.content, updateField]);

  // Memoized computed props - stable values
  const isOwner = useMemo(
    () => isDocOwner(user?.email, doc?.ownerEmail),
    [user?.email, doc?.ownerEmail]
  );

  // Memoize toolbar element - only recreates when manual save status changes
  // Auto-save status is ignored - it runs silently in the background
  const toolbarElement = useMemo(
    () => (
      <DocToolbar
        onBack={handleBack}
        onSave={handleSave}
        saveStatus={saveStatus} // Only show manual save status in UI
        onShare={handleShare}
        onShareViaEmail={handleShareViaEmail}
        onAttachedFiles={handleAttachedFiles}
        onDelete={openDeleteDialog}
        onFormatDocument={handleFormatDocument}
        isOwner={isOwner}
        filesCount={files.length}
        isNew={isNew}
        isSaving={isSaving}
      />
    ),
    [
      handleBack,
      handleSave,
      saveStatus, // Only recreate when manual save status changes
      handleShare,
      handleShareViaEmail,
      handleAttachedFiles,
      openDeleteDialog,
      handleFormatDocument,
      isOwner,
      files.length,
      isNew,
      isSaving, // Only recreate when manual saving state changes
    ]
  );


  if (isLoading && !isNew) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading doc...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in w-full overflow-x-hidden -mt-4 sm:-mt-6 min-w-0" style={{ maxWidth: '100%', width: '100%', boxSizing: 'border-box' }}>
      {/* Mobile buttons at top - using DetailPageHeader for consistency */}
      <div className="sm:hidden mb-4">
        <DetailPageHeader
          title={formState.title || "Untitled"}
          backHref="/docs"
          actions={createDocActions(isOwner, files.length, {
            onShare: handleShare,
            onShareViaEmail: handleShareViaEmail,
            onAttachedFiles: handleAttachedFiles,
            onDelete: openDeleteDialog,
          })}
          showActions={!isNew && !!doc}
          hideTitle={true}
        />
      </div>

      {(!isNew && isLoading && !doc) ? (
        <div className="min-h-[500px] border border-border/30 rounded-lg flex items-center justify-center px-3 sm:px-6">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      ) : (
        <div className="w-full min-w-0" style={{ maxWidth: '100%', width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
          <div className="border-t border-b border-border/30 w-full max-w-full bg-background shadow-sm relative min-w-0" style={{ maxWidth: '100%', width: '100%', boxSizing: 'border-box' }}>
            {/* Toolbar positioned at top-right aligned with editor content */}
            <div className="absolute top-3 right-2 sm:right-3 z-10 hidden sm:flex items-center gap-1">
              {toolbarElement}
            </div>
            <TitleWithToolbar
              title={formState.title}
              onTitleChange={(title) => updateField('title', title)}
              titlePlaceholder="Doc title..."
              readOnly={false}
              toolbar={null} // Remove toolbar from title component
            />
            <RichTextEditor
              key={docId || "new"}
              content={formState.content || ""}
              onChange={(content) => {
                // Content is now a TipTap JSON object, stringify it for storage
                const contentString = typeof content === 'string' ? content : JSON.stringify(content);
                updateField('content', contentString);
              }}
              placeholder="Start writing..."
              readOnly={false}
              onFileUpload={handleFileUpload}
              docId={docId || undefined}
            />
          </div>
        </div>
      )}

      {/* Attached Files Dialog */}
      <Dialog open={dialogs.filesDialogOpen} onOpenChange={(open) => open ? dialogs.openDialog('files') : dialogs.closeDialog()}>
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
                      onClick={() => window.open(file.fileUrl, '_blank')}
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
      <AlertDialog open={!!fileToDelete} onOpenChange={(open) => !open && setFileToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{fileToDelete?.fileName}" from this document? This will remove the file reference, but the file will remain in storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveFile} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Doc Confirmation Dialog */}
      <AlertDialog open={dialogs.deleteDialogOpen} onOpenChange={(open) => open ? dialogs.openDialog('delete') : dialogs.closeDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{doc?.title || formState.title || 'this document'}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Limit Visibility Dialog */}
      {!isNew && doc && (
        <LimitVisibilityDialog
          open={dialogs.shareDialogOpen}
          onOpenChange={(open) => open ? dialogs.openDialog('share') : dialogs.closeDialog()}
          title="Limit Document Visibility"
          itemName={doc.title}
          currentVisibility={formState.visibility}
          currentVisibleToMembers={formState.visibleToMembers}
          onSave={async (newVisibility, newVisibleToMembers) => {
            updateField('visibility', newVisibility);
            // Ensure newVisibleToMembers is always an array
            const membersArray = Array.isArray(newVisibleToMembers) ? newVisibleToMembers : [];
            updateField('visibleToMembers', membersArray);
            await updateDoc.mutateAsync({
              docId: doc.id,
              updates: {
                visibility: newVisibility,
                visibleToMembers: membersArray,
              },
            });
            toast({
              title: "Visibility updated",
              description: "Document visibility has been updated successfully.",
            });
          }}
        />
      )}

      {/* Share Document Dialog */}
      {!isNew && doc && (
        <ShareDocDialog
          open={dialogs.shareViaEmailDialogOpen}
          onOpenChange={(open) => open ? dialogs.openDialog('shareViaEmail') : dialogs.closeDialog()}
          docId={doc.id}
          docTitle={doc.title}
        />
      )}

    </div>
  );
});

