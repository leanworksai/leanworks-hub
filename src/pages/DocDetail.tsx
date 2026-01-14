import { useParams, useNavigate } from "react-router-dom";
import { memo, useEffect, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useDoc, useUpdateDoc, useDeleteDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { Download, File, Paperclip, Trash2, ArrowLeft, MoreVertical } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { ShareDocDialog } from "@/components/ShareDocDialog";
import { useAutoSave } from "@/hooks/useAutoSave";
import { trackEvent, trackView } from "@/lib/analytics";
import { initOfflineQueue } from "@/services/offlineQueue";
import { useScrollTracking } from "@/hooks/useScrollTracking";
import { usePageContext } from "@/contexts/PageContext";
import { DocToolbar } from "@/components/DocToolbar";
import { useDocDialogs } from "@/hooks/useDocDialogs";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import { useSidebar } from "@/components/ui/sidebar";
import { useDocFiles } from "@/hooks/useDocFiles";
import type { DocFile } from "@/data/docsData";
import { useDocForm } from "@/hooks/useDocForm";
import { isDocOwner, formatFileSize, createDocActions } from "@/utils/docUtils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  
  // Ref to store save promise resolvers for image uploads
  const savePromiseResolversRef = useRef<Array<(docId: string) => void>>([]);

  // Extract title from first line of content
  const extractedTitle = useMemo(() => {
    return extractFirstLineAsTitle(formState.content || '', 100);
  }, [formState.content]);

  // Auto-save hook - always enabled since we're always in edit mode
  const autoSave = useAutoSave({
    docId: docId || 'new',
    title: extractedTitle,
    content: formState.content,
    visibility: formState.visibility,
    visibleToMembers: formState.visibleToMembers,
    files,
    enabled: true,
    onSaveSuccess: (savedDocId: string, isManual: boolean) => {
      // Resolve any pending save promises
      savePromiseResolversRef.current.forEach(resolve => resolve(savedDocId));
      savePromiseResolversRef.current = [];

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
      // Reject any pending save promises
      savePromiseResolversRef.current.forEach(() => {
        // Clear the array - promises will timeout
      });
      savePromiseResolversRef.current = [];
      
      // Errors are handled by the hook's status
      console.error('Auto-save error:', error);
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

  // Set page context when doc loads - use extracted title from content
  useEffect(() => {
    if (doc && docId && docId !== 'new') {
      const title = extractFirstLineAsTitle(doc.content || doc.title || '', 100);
      if (title) {
        setContext('doc', { id: docId, title });
      } else {
        clearContext();
      }
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
      const deletedTitle = doc?.title || extractFirstLineAsTitle(doc?.content || '', 100) || 'Doc';
      toast({
        title: "Doc deleted",
        description: `"${deletedTitle}" has been deleted successfully.`,
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

  // Handler to add image to attachments (bypasses handleFileUpload to avoid docId check)
  const handleImageAdded = useCallback(async (fileInfo: {
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
  }, savedDocId: string) => {
    // Use the saved docId passed from handleImageUpload (already saved at this point)
    if (!savedDocId || savedDocId === 'new') {
      console.warn('Image added but docId is invalid - file will be added on next save');
      return;
    }

    // Create new file object
    const newFile: DocFile = {
      fileId: fileInfo.fileId,
      fileName: fileInfo.fileName,
      fileUrl: fileInfo.fileUrl,
      fileSize: fileInfo.fileSize,
      mimeType: fileInfo.mimeType,
      uploadedAt: new Date().toISOString(),
    };

    // Add to local files state (this will trigger auto-save to update metadata)
    // Note: We don't directly update metadata here to avoid race conditions
    // The auto-save hook will pick up the files change and save it
    // But we need to update the files state in useDocFiles
    // For now, we'll update the doc metadata directly since we have the file info
    const updatedFiles = [...files, newFile];
    
    try {
      await updateDoc.mutateAsync({
        docId: savedDocId,
        updates: {
          metadata: {
            files: updatedFiles,
          },
        },
      });
    } catch (error) {
      console.error('Failed to add image to attachments:', error);
      // Don't throw - image is already in content, attachment is secondary
    }
  }, [files, updateDoc]);

  // Handler to save document first if needed (for image uploads on new docs)
  const handleSaveFirst = useCallback(async (): Promise<string | null> => {
    // If docId is not 'new', return it immediately
    if (docId && docId !== 'new') {
      return docId;
    }

    // Create a promise that will be resolved when save succeeds
    return new Promise((resolve) => {
      // Add resolver to the ref array
      savePromiseResolversRef.current.push(resolve);

      // Trigger manual save using auto-save
      autoSave.manualSave().catch(() => {
        // On error, remove this resolver and resolve with null
        const index = savePromiseResolversRef.current.indexOf(resolve);
        if (index > -1) {
          savePromiseResolversRef.current.splice(index, 1);
        }
        resolve(null);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        const index = savePromiseResolversRef.current.indexOf(resolve);
        if (index > -1) {
          savePromiseResolversRef.current.splice(index, 1);
          resolve(null);
        }
      }, 10000);
    });
  }, [docId, autoSave]);

  // Memoized handlers - stable references to prevent DocToolbar re-renders
  const handleBack = useCallback(() => navigate("/docs"), [navigate]);
  const handleShare = useCallback(() => dialogs.openDialog('share'), [dialogs.openDialog]);
  const handleShareViaEmail = useCallback(() => dialogs.openDialog('shareViaEmail'), [dialogs.openDialog]);
  const handleAttachedFiles = useCallback(() => dialogs.openDialog('files'), [dialogs.openDialog]);
  const openDeleteDialog = useCallback(() => dialogs.openDialog('delete'), [dialogs.openDialog]);

  // Track keyboard visibility on mobile
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  
  // Get sidebar state to adjust toolbar position
  const sidebar = useSidebar();
  const sidebarLeft = useMemo(() => {
    if (sidebar.state === 'collapsed' && sidebar.open) {
      // Sidebar is collapsed to icon mode - use icon width (3rem = 48px)
      return '3rem';
    } else if (!sidebar.open) {
      // Sidebar is hidden (offcanvas)
      return '0';
    } else {
      // Sidebar is expanded - use full width (12rem = 192px)
      return '12rem';
    }
  }, [sidebar.state, sidebar.open]);
  
  useEffect(() => {
    // Only run on mobile
    if (window.innerWidth >= 640) return;
    
    const handleFocus = () => {
      setIsKeyboardVisible(true);
    };
    
    const handleBlur = () => {
      // Delay hiding to allow for keyboard dismissal animation
      setTimeout(() => {
        setIsKeyboardVisible(false);
      }, 100);
    };
    
    // Use visual viewport API if available (more reliable)
    if (window.visualViewport) {
      const handleViewportChange = () => {
        const viewport = window.visualViewport;
        if (viewport) {
          // Keyboard is visible when viewport height is significantly less than window height
          const heightDiff = window.innerHeight - viewport.height;
          setIsKeyboardVisible(heightDiff > 150); // Threshold for keyboard detection
        }
      };
      
      window.visualViewport.addEventListener('resize', handleViewportChange);
      window.visualViewport.addEventListener('scroll', handleViewportChange);
      
      return () => {
        window.visualViewport?.removeEventListener('resize', handleViewportChange);
        window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      };
    } else {
      // Fallback: listen to focus/blur on contenteditable elements
      const editorElement = document.querySelector('.ProseMirror');
      if (editorElement) {
        editorElement.addEventListener('focus', handleFocus);
        editorElement.addEventListener('blur', handleBlur);
        
        return () => {
          editorElement.removeEventListener('focus', handleFocus);
          editorElement.removeEventListener('blur', handleBlur);
        };
      }
    }
  }, []);

  // Memoized computed props - stable values
  const isOwner = useMemo(
    () => isDocOwner(user?.email, doc?.ownerEmail),
    [user?.email, doc?.ownerEmail]
  );

  // Memoize top toolbar (back button and menu) - always visible
  const topToolbarElement = useMemo(
    () => (
      <DocToolbar
        onBack={handleBack}
        onShare={handleShare}
        onShareViaEmail={handleShareViaEmail}
        onAttachedFiles={handleAttachedFiles}
        onDelete={openDeleteDialog}
        isOwner={isOwner}
        filesCount={files.length}
        isNew={isNew}
      />
    ),
    [
      handleBack,
      handleShare,
      handleShareViaEmail,
      handleAttachedFiles,
      openDeleteDialog,
      isOwner,
      files.length,
      isNew,
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
      {(!isNew && isLoading && !doc) ? (
        <div className="min-h-[500px] border border-border/30 rounded-lg flex items-center justify-center px-3 sm:px-6">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      ) : (
        <div className="w-full min-w-0" style={{ maxWidth: '100%', width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
          <div className="border-t border-b border-border/30 w-full max-w-full bg-background shadow-sm relative min-w-0" style={{ maxWidth: '100%', width: '100%', boxSizing: 'border-box' }}>
            {/* Mobile header - back button and menu (always visible) */}
            <div className="sticky top-0 z-20 sm:hidden bg-background border-b border-border/30 px-2 py-2 flex items-center justify-between">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleBack}
                className="hover:bg-muted/50"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {!isNew && !!doc && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {createDocActions(isOwner, files.length, {
                      onShare: handleShare,
                      onShareViaEmail: handleShareViaEmail,
                      onAttachedFiles: handleAttachedFiles,
                      onDelete: openDeleteDialog,
                    }).map((action, index) => (
                      <DropdownMenuItem
                        key={index}
                        onClick={action.onClick}
                        className={action.destructive ? "text-destructive focus:text-destructive" : ""}
                      >
                        {action.icon && <span className="mr-2">{action.icon}</span>}
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            
            {/* Mobile toolbar - top (edit mode only, shows with keyboard, scrolls with content) */}
            {/* Note: Back button and 3 dots are in the mobile header above, not in this toolbar */}
            
            {/* Editor - padding handled internally by RichTextEditor */}
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
              onImageAdded={handleImageAdded}
              docId={docId || undefined}
              onSaveFirst={handleSaveFirst}
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
              Are you sure you want to delete "{doc?.title || extractFirstLineAsTitle(doc?.content || '', 100) || 'this document'}"? This action cannot be undone.
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
          itemName={doc.title || extractFirstLineAsTitle(doc.content || '', 100)}
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
          docTitle={doc.title || extractFirstLineAsTitle(doc.content || '', 100)}
        />
      )}

    </div>
  );
});

