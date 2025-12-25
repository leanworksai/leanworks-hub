import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useDoc, useCreateDoc, useUpdateDoc, useDeleteDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Share2, Download, File, MoreVertical, Paperclip, Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/AuthContext";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { fileUploadService } from "@/services/api";
import type { DocFile } from "@/data/docsData";
import { useAutoSave } from "@/hooks/useAutoSave";
import { DraftRecoveryDialog } from "@/components/DraftRecoveryDialog";
import { getDraft, removeDraft, isDraftNewer } from "@/services/draftService";
import { initOfflineQueue } from "@/services/offlineQueue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export default function DocDetail() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const isNew = docId === "new";
  const { data: doc, isLoading } = useDoc(docId || "");
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const deleteDoc = useDeleteDoc();
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<'all_members' | 'specific_members'>('all_members');
  const [visibleToMembers, setVisibleToMembers] = useState<Set<string>>(new Set());
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [filesDialogOpen, setFilesDialogOpen] = useState(false);
  const [files, setFiles] = useState<DocFile[]>([]);
  const [fileToDelete, setFileToDelete] = useState<DocFile | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [draftRecoveryOpen, setDraftRecoveryOpen] = useState(false);
  const [hasCheckedDraft, setHasCheckedDraft] = useState(false);
  
  // Auto-save hook - always enabled since we're always in edit mode
  const autoSave = useAutoSave({
    docId: docId || 'new',
    title,
    content,
    visibility,
    visibleToMembers: Array.from(visibleToMembers),
    files,
    enabled: true,
    onSaveSuccess: () => {
      // Show success toast only for manual saves or first-time saves
      if (docId === 'new') {
        toast({
          title: "Doc created",
          description: `"${title}" has been created successfully.`,
        });
      }
    },
    onSaveError: (error) => {
      // Errors are handled by the hook's status
      console.error('Auto-save error:', error);
    },
  });

  // Initialize offline queue monitoring
  useEffect(() => {
    const cleanup = initOfflineQueue();
    return cleanup;
  }, []);

  // Check for draft recovery on mount
  useEffect(() => {
    if (hasCheckedDraft || !user?.email) return;
    
    const checkDraft = () => {
      const draft = getDraft(docId || 'new', user.email);
      
      if (draft) {
        // Check if draft is newer than server version
        const serverUpdatedAt = doc?.updatedAt;
        if (isDraftNewer(docId || 'new', user.email, serverUpdatedAt)) {
          setDraftRecoveryOpen(true);
        } else {
          // Draft is older, discard it
          removeDraft(docId || 'new', user.email);
        }
      }
      
      setHasCheckedDraft(true);
    };

    // Wait for doc to load before checking draft
    if (isNew || (doc && !isLoading)) {
      checkDraft();
    }
  }, [doc, isNew, isLoading, user?.email, docId, hasCheckedDraft]);

  // Load doc data
  useEffect(() => {
    if (doc && !isNew) {
      setTitle(doc.title || "");
      // Preserve content even if it's empty string, only default to empty if it's null/undefined
      setContent(doc.content !== null && doc.content !== undefined ? doc.content : "");
      setVisibility(doc.visibility || 'all_members');
      // Ensure visibleToMembers is always an array before creating Set
      const membersArray = Array.isArray(doc.visibleToMembers) ? doc.visibleToMembers : [];
      setVisibleToMembers(new Set(membersArray));
      // Load files from metadata
      const docFiles = doc.metadata?.files || [];
      setFiles(Array.isArray(docFiles) ? docFiles : []);
    } else if (isNew) {
      // Reset form for new doc
      setTitle("");
      setContent("");
      setVisibility('all_members');
      setVisibleToMembers(new Set());
      setFiles([]);
    }
  }, [doc, isNew]);

  const handleFileUpload = async (file: File) => {
    if (!docId || docId === "new") {
      toast({
        title: "Error",
        description: "Please save the document first before uploading files",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await fileUploadService.uploadFile(docId, file);
      
      // Add file to local state
      const newFile: DocFile = {
        fileId: result.fileId,
        fileName: result.fileName,
        fileUrl: result.fileUrl,
        fileSize: result.fileSize,
        mimeType: result.mimeType,
        uploadedAt: new Date().toISOString(),
      };
      
      const updatedFiles = [...files, newFile];
      setFiles(updatedFiles);

      // Update doc metadata with new file
      await updateDoc.mutateAsync({
        docId,
        updates: {
          metadata: {
            files: updatedFiles,
          },
        },
      });

      toast({
        title: "File uploaded",
        description: `"${result.fileName}" has been uploaded successfully.`,
      });
    } catch (error) {
      throw error; // Re-throw to let RichTextEditor handle the error
    }
  };

  const handleRemoveFile = async () => {
    if (!fileToDelete || !docId || docId === "new") {
      return;
    }

    try {
      // Remove file from local state
      const updatedFiles = files.filter(f => f.fileId !== fileToDelete.fileId);
      setFiles(updatedFiles);

      // Update doc metadata
      await updateDoc.mutateAsync({
        docId,
        updates: {
          metadata: {
            files: updatedFiles,
          },
        },
      });

      toast({
        title: "File removed",
        description: `"${fileToDelete.fileName}" has been removed from the document.`,
      });

      setFileToDelete(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to remove file",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!docId || docId === "new") {
      return;
    }

    try {
      await deleteDoc.mutateAsync(docId);
      toast({
        title: "Doc deleted",
        description: `"${title || doc?.title || 'Doc'}" has been deleted successfully.`,
      });
      navigate('/docs');
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete doc",
        variant: "destructive",
      });
    }
  };

  // Handle draft recovery
  const handleDraftRestore = () => {
    if (!user?.email) return;
    
    const draft = getDraft(docId || 'new', user.email);
    if (draft) {
      setTitle(draft.title);
      setContent(draft.content);
      setVisibility(draft.visibility);
      setVisibleToMembers(new Set(draft.visibleToMembers));
      setFiles(draft.files || []);
      removeDraft(docId || 'new', user.email);
    }
    
    setDraftRecoveryOpen(false);
  };

  const handleDraftDiscard = () => {
    if (!user?.email) return;
    removeDraft(docId || 'new', user.email);
    setDraftRecoveryOpen(false);
  };

  const handleUseServerVersion = () => {
    if (!user?.email) return;
    removeDraft(docId || 'new', user.email);
    setDraftRecoveryOpen(false);
  };

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
    <div className="animate-fade-in w-full overflow-x-hidden">
      {(!isNew && isLoading && !doc) ? (
        <div className="min-h-[500px] border border-border/30 rounded-lg flex items-center justify-center -mx-4 sm:-mx-6">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      ) : (
        <div className="-mx-4 sm:-mx-6 -mt-2">
          <RichTextEditor 
            key={docId || "new"}
            content={content || ""} 
            onChange={setContent}
            title={title}
            onTitleChange={setTitle}
            titlePlaceholder="Doc title..."
            readOnly={false}
            onFileUpload={handleFileUpload}
            docId={docId || undefined}
            titleRightActions={
              <>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => navigate("/docs")}
                  className="hover:bg-muted/50"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {!isNew && doc && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {user?.email?.toLowerCase() === doc.ownerEmail?.toLowerCase() && (
                        <DropdownMenuItem onClick={() => setShareDialogOpen(true)}>
                          <Share2 className="mr-2 h-4 w-4" />
                          Limit Visibility
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setFilesDialogOpen(true)}>
                        <Paperclip className="mr-2 h-4 w-4" />
                        Attached Files {files.length > 0 && `(${files.length})`}
                      </DropdownMenuItem>
                      {user?.email?.toLowerCase() === doc.ownerEmail?.toLowerCase() && (
                        <DropdownMenuItem 
                          onClick={() => setShowDeleteDialog(true)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            }
          />
        </div>
      )}

      {/* Attached Files Dialog */}
      <Dialog open={filesDialogOpen} onOpenChange={setFilesDialogOpen}>
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
                        {(file.fileSize / 1024).toFixed(1)} KB
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
                    {!isNew && doc && user?.email?.toLowerCase() === doc.ownerEmail?.toLowerCase() && (
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
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{doc?.title || title || 'this document'}"? This action cannot be undone.
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
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          title="Limit Document Visibility"
          itemName={doc.title}
          currentVisibility={visibility}
          currentVisibleToMembers={Array.from(visibleToMembers)}
          onSave={async (newVisibility, newVisibleToMembers) => {
            setVisibility(newVisibility);
            // Ensure newVisibleToMembers is always an array before creating Set
            const membersArray = Array.isArray(newVisibleToMembers) ? newVisibleToMembers : [];
            setVisibleToMembers(new Set(membersArray));
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

      {/* Draft Recovery Dialog */}
      {user?.email && (
        <DraftRecoveryDialog
          open={draftRecoveryOpen}
          onOpenChange={setDraftRecoveryOpen}
          draft={user.email ? getDraft(docId || 'new', user.email) : null}
          serverUpdatedAt={doc?.updatedAt}
          onRestore={handleDraftRestore}
          onDiscard={handleDraftDiscard}
          onUseServer={handleUseServerVersion}
        />
      )}
    </div>
  );
}

