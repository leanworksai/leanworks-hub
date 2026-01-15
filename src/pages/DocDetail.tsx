// External dependencies
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { memo, useEffect, useCallback, useMemo, useRef } from "react";

// Internal components
import { RichTextEditor } from "@/components/RichTextEditor";
import { DocDetailDialogs } from "@/components/DocDetailDialogs";
import { DocDetailToolbar } from "@/components/DocDetailToolbar";

// Hooks
import { useDoc, useUpdateDoc, useDeleteDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useScrollTracking } from "@/hooks/useScrollTracking";
import { usePageContext } from "@/contexts/PageContext";
import { useDocDialogs } from "@/hooks/useDocDialogs";
import { useDocFiles } from "@/hooks/useDocFiles";
import { useDocForm } from "@/hooks/useDocForm";

// Utils/lib
import { trackEvent, trackView } from "@/lib/analytics";
import { initOfflineQueue } from "@/services/offlineQueue";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import { saveLastOpenedDoc, loadLastOpenedDoc } from "@/utils/docsStorage";
import { isDocOwner } from "@/utils/docUtils";

// Types
import type { DocFile } from "@/data/docsData";

export default memo(function DocDetail() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNew = docId === "new";
  const { data: doc, isLoading } = useDoc(docId || "");
  const updateDoc = useUpdateDoc();
  const deleteDoc = useDeleteDoc();
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { setContext, clearContext } = usePageContext();
  const previousOrgIdRef = useRef<string | null>(currentOrg?.id || null);

  // Track scroll depth for engagement
  useScrollTracking(true);

  // Custom hooks for state management
  const dialogs = useDocDialogs();
  const { formState, updateField } = useDocForm({ initialDoc: doc, isNew });
  const {
    files,
    handleFileUpload,
    handleRemoveFile,
    fileToDelete,
    setFileToDelete,
  } = useDocFiles({
    docId: docId || "new",
    initialFiles: doc?.metadata?.files || [],
  });

  // Handle action query params from catalog navigation
  useEffect(() => {
    const action = searchParams.get('action');
    if (action && doc && !isNew) {
      // Map action query params to dialog types
      const actionMap: Record<string, 'share' | 'shareViaEmail' | 'files' | 'delete'> = {
        'share': 'share',
        'shareEmail': 'shareViaEmail',
        'files': 'files',
        'delete': 'delete',
      };
      
      const dialogType = actionMap[action];
      if (dialogType) {
        dialogs.openDialog(dialogType);
        // Remove the query param after opening dialog
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, doc, isNew, dialogs, setSearchParams]);

  // Ref to store save promise resolvers for image uploads
  const savePromiseResolversRef = useRef<Array<(docId: string) => void>>([]);

  // Extract title from first line of content
  const extractedTitle = useMemo(() => {
    return extractFirstLineAsTitle(formState.content || "", 100);
  }, [formState.content]);

  // Auto-save hook - always enabled since we're always in edit mode
  const autoSave = useAutoSave({
    docId: docId || "new",
    title: extractedTitle,
    content: formState.content,
    visibility: formState.visibility,
    visibleToMembers: formState.visibleToMembers,
    files,
    enabled: true,
    onSaveSuccess: (savedDocId: string, isManual: boolean) => {
      // Resolve any pending save promises
      savePromiseResolversRef.current.forEach((resolve) => resolve(savedDocId));
      savePromiseResolversRef.current = [];

      // Track document save
      trackEvent("doc_saved", {
        doc_id: savedDocId,
        save_method: isManual ? "manual" : "auto",
      });

      // Track document edit if it's an existing doc
      if (docId !== "new" && savedDocId) {
        trackEvent("doc_edited", {
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
      // Clear the array - promises will timeout
      savePromiseResolversRef.current = [];

      // Errors are handled by the hook's status
      console.error("Auto-save error:", error);
    },
  });

  // Initialize offline queue monitoring
  useEffect(() => {
    const cleanup = initOfflineQueue();
    return cleanup;
  }, []);

  // Track document view and save last opened doc per org
  useEffect(() => {
    if (docId && docId !== "new" && doc && user?.email && currentOrg?.id) {
      trackView("doc", docId);
      // Persist last opened doc per org
      saveLastOpenedDoc(user.email, currentOrg.id, docId);
    }
  }, [docId, doc, user?.email, currentOrg?.id]);

  // Handle org switch from doc detail page
  useEffect(() => {
    const previousOrgId = previousOrgIdRef.current;
    const currentOrgId = currentOrg?.id || null;

    // If org changed and we're on a doc detail page (not /docs/new)
    if (
      previousOrgId !== null &&
      previousOrgId !== currentOrgId &&
      docId &&
      docId !== "new" &&
      user?.email &&
      currentOrgId
    ) {
      const lastOpenedDoc = loadLastOpenedDoc(user.email, currentOrgId);
      if (lastOpenedDoc) {
        // Navigate to the new org's last opened doc
        navigate(`/docs/${lastOpenedDoc}`, { replace: true });
      } else {
        // No last opened doc for new org, navigate to blank page
        navigate("/docs", { replace: true });
      }
    }

    // Update ref for next comparison
    previousOrgIdRef.current = currentOrgId;
  }, [currentOrg?.id, docId, navigate, user?.email]);

  // Set page context when doc loads - use extracted title from content
  useEffect(() => {
    if (doc && docId && docId !== "new") {
      const title = extractFirstLineAsTitle(doc.content || doc.title || "", 100);
      if (title) {
        setContext("doc", { id: docId, title });
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
      const deletedTitle =
        doc?.title ||
        extractFirstLineAsTitle(doc?.content || "", 100) ||
        "Doc";
      toast({
        title: "Doc deleted",
        description: `"${deletedTitle}" has been deleted successfully.`,
      });
      navigate("/docs");
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete doc",
        variant: "destructive",
      });
    }
  }, [docId, deleteDoc, toast, navigate, doc?.title, doc?.content]);

  // Handler to add image to attachments (bypasses handleFileUpload to avoid docId check)
  const handleImageAdded = useCallback(
    async (
      fileInfo: {
        fileId: string;
        fileName: string;
        fileUrl: string;
        fileSize: number;
        mimeType: string;
      },
      savedDocId: string
    ) => {
      // Use the saved docId passed from handleImageUpload (already saved at this point)
      if (!savedDocId || savedDocId === "new") {
        console.warn(
          "Image added but docId is invalid - file will be added on next save"
        );
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
        console.error("Failed to add image to attachments:", error);
        // Don't throw - image is already in content, attachment is secondary
      }
    },
    [files, updateDoc]
  );

  // Handler to save document first if needed (for image uploads on new docs)
  const handleSaveFirst = useCallback(async (): Promise<string | null> => {
    // If docId is not 'new', return it immediately
    if (docId && docId !== "new") {
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

  // Memoized handlers - stable references to prevent re-renders
  const handleBack = useCallback(() => {
    // Navigate to docs (on mobile this will show catalog page, on desktop it shows sidebar)
    // Use replace: false to ensure proper navigation
    navigate("/docs", { replace: false });
  }, [navigate]);
  const handleShare = useCallback(
    () => dialogs.openDialog("share"),
    [dialogs.openDialog]
  );
  const handleShareViaEmail = useCallback(
    () => dialogs.openDialog("shareViaEmail"),
    [dialogs.openDialog]
  );
  const handleAttachedFiles = useCallback(
    () => dialogs.openDialog("files"),
    [dialogs.openDialog]
  );
  const openDeleteDialog = useCallback(
    () => dialogs.openDialog("delete"),
    [dialogs.openDialog]
  );

  // Memoized computed props - stable values
  const isOwner = useMemo(
    () => isDocOwner(user?.email, doc?.ownerEmail),
    [user?.email, doc?.ownerEmail]
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
    <div
      className="animate-fade-in w-full overflow-x-hidden min-w-0"
      style={{ maxWidth: "100%", width: "100%", boxSizing: "border-box" }}
    >
      {!isNew && isLoading && !doc ? (
        <div className="min-h-[500px] border border-border/30 rounded-lg flex items-center justify-center px-3 sm:px-6">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      ) : (
        <div
          className="w-full min-w-0"
          style={{
            maxWidth: "100%",
            width: "100%",
            boxSizing: "border-box",
            overflowX: "hidden",
          }}
        >
          <div
            className="w-full max-w-full bg-background relative min-w-0"
            style={{
              maxWidth: "100%",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <DocDetailToolbar
              onBack={handleBack}
              onShare={handleShare}
              onShareViaEmail={handleShareViaEmail}
              onAttachedFiles={handleAttachedFiles}
              onDelete={openDeleteDialog}
              isOwner={isOwner}
              filesCount={files.length}
              isNew={isNew}
              doc={doc}
            />

            {/* Editor - padding handled internally by RichTextEditor */}
            <RichTextEditor
              key={docId || "new"}
              content={formState.content || ""}
              onChange={(content) => {
                // Content is now a TipTap JSON object, stringify it for storage
                const contentString =
                  typeof content === "string" ? content : JSON.stringify(content);
                updateField("content", contentString);
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

      <DocDetailDialogs
        dialogs={dialogs}
        files={files}
        fileToDelete={fileToDelete}
        setFileToDelete={setFileToDelete}
        handleRemoveFile={handleRemoveFile}
        doc={doc}
        isNew={isNew}
        isOwner={isOwner}
        formState={formState}
        updateField={updateField}
        updateDoc={updateDoc}
        handleDelete={handleDelete}
        toast={toast}
      />
    </div>
  );
});
