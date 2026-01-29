// External dependencies
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { memo, useEffect, useCallback, useMemo, useRef, useState } from "react";

// Internal components
import { RichTextEditor } from "@/components/RichTextEditor";
import { PDFViewer } from "@/components/PDFViewer";
import { DocumentViewer } from "@/components/DocumentViewer";
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
import { useQueryClient } from "@tanstack/react-query";

// Utils/lib
import { trackEvent, trackView } from "@/lib/analytics";
import { initOfflineQueue } from "@/services/offlineQueue";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import { saveLastOpenedDoc, loadLastOpenedDoc } from "@/utils/docsStorage";
import { isDocOwner } from "@/utils/docUtils";
import { removeDraft } from "@/services/draftService";
import { exportEditorToPDF, generateFilenameWithTimestamp } from "@/utils/pdfExport";

// Types
import type { DocFile, Doc } from "@/data/docsData";

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
  const queryClient = useQueryClient();
  const previousOrgIdRef = useRef<string | null>(currentOrg?.id || null);
  const previousDocIdRef = useRef<string | null>(null);
  // Track when we switch to new doc to force complete reset
  // Generate a unique key when transitioning to a new doc
  const editorKeyRef = useRef<string>(docId || "new");
  
  // CRITICAL: Update key immediately when docId changes to force editor remount
  // This prevents showing old content during transitions
  const currentDocId = docId || "new";
  if (currentDocId !== previousDocIdRef.current) {
    // Doc changed - generate new key to force editor remount
    if (isNew) {
      editorKeyRef.current = `new-${Date.now()}-${Math.random()}`;
    } else if (docId) {
      editorKeyRef.current = docId;
    }
    previousDocIdRef.current = currentDocId;
  }
  
  const editorKey = editorKeyRef.current;

  // Track scroll depth for engagement
  useScrollTracking(true);

  // State for download URL for uploaded files
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Custom hooks for state management
  const dialogs = useDocDialogs();
  // When creating a new doc, explicitly pass null to prevent copying previous doc data
  // Also ensure doc is undefined when isNew is true to prevent any stale data
  const docForForm = isNew ? null : (doc || null);
  const { formState, updateField, reset: resetForm, setFormState } = useDocForm({ initialDoc: docForForm, isNew });
  
  // Track previous docId to detect navigation to new doc
  const prevDocIdRef = useRef<string | null>(null);
  
  // Immediately reset form state when transitioning to new doc (synchronously, not in useEffect)
  if (isNew && prevDocIdRef.current !== "new" && prevDocIdRef.current !== null) {
    // We're transitioning from an existing doc to a new one
    console.log('[DocDetail] Transitioning to new doc, resetting form state immediately');
    if (formState.content && formState.content.trim() && formState.content !== '<p></p>' && !formState.content.startsWith('{"type":"doc","content":[{"type":"paragraph"')) {
      // Force synchronous reset
      setFormState({
        title: '',
        content: '',
        visibility: 'all_members',
        visibleToMembers: [],
      });
    }
  }
  prevDocIdRef.current = docId || "new";
  
  // Note: Docs are now created immediately when user clicks "create"
  // So we no longer need optimistic temp entries here
  
  // DEBUG: Log when formState changes
  useEffect(() => {
    if (isNew) {
      console.log('[DocDetail] isNew=true, formState.content length:', formState.content?.length || 0);
      // Force reset if content is not empty
      if (formState.content && formState.content.trim() && formState.content !== '<p></p>' && !formState.content.startsWith('{"type":"doc","content":[{"type":"paragraph"')) {
        console.log('[DocDetail] WARNING: formState has content when isNew=true, forcing reset in useEffect');
        setFormState({
          title: '',
          content: '',
          visibility: 'all_members',
          visibleToMembers: [],
        });
      }
    }
  }, [isNew, formState.content, setFormState]);
  const {
    files,
    handleFileUpload,
    handleRemoveFile,
    fileToDelete,
    setFileToDelete,
  } = useDocFiles({
    docId: docId || "new",
    initialFiles: isNew ? [] : (doc?.metadata?.files || []),
  });

  // Clear draft and reset form when creating a new doc to ensure fresh start
  useEffect(() => {
    if (isNew && user?.email) {
      removeDraft('new', user.email);
      // Explicitly reset form state to ensure clean slate
      resetForm();
    }
  }, [isNew, user?.email, resetForm]);

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
  // For new docs: always show "Untitled" until user starts typing actual text
  // For existing docs: extract from content or show "Untitled"
  const extractedTitle = useMemo(() => {
    if (isNew) {
      // For new docs, check if content has actual user-typed text
      // TipTap default structure: {"type":"doc","content":[{"type":"paragraph"}]}
      // Empty content variations to check:
      const isEmpty = !formState.content || 
        !formState.content.trim() || 
        formState.content === '<p></p>' || 
        formState.content === '{"type":"doc","content":[{"type":"paragraph"}]}' ||
        formState.content === '{"type":"doc","content":[{"type":"paragraph","content":[]}]}' ||
        formState.content.startsWith('{"type":"doc","content":[{"type":"paragraph"}]}');
      
      if (isEmpty) {
        return "Untitled";
      }
      
      // Try to extract title from content
      const title = extractFirstLineAsTitle(formState.content, 100);
      
      // Only use extracted title if it has actual non-whitespace text
      // If extraction returns empty or whitespace, show "Untitled"
      if (title && title.trim() && title.trim().length > 0) {
        return title.trim();
      }
      
      return "Untitled";
    } else {
      // For existing docs, extract title from content
      const title = extractFirstLineAsTitle(formState.content || "", 100);
      return title || "Untitled";
    }
  }, [formState.content, isNew]);

  // Update React Query cache in real-time when content changes to sync title in docs list
  // Note: We don't update updatedAt here to prevent list shuffling - only update content for title display
  // CRITICAL: Only update cache if we're still on the same doc to prevent flash
  useEffect(() => {
    // Skip cache updates during doc transitions to prevent showing old content
    if (isNew || !docId || !formState.content || !currentOrg?.id) {
      return;
    }
    
    // Only update if docId matches the current doc (prevents race conditions)
    if (doc && doc.id === docId) {
      // Get current docs list from cache
      const docs = queryClient.getQueryData<Doc[]>(['docs', currentOrg.id]);
      if (docs) {
        // Find the current doc in the list
        const docIndex = docs.findIndex(d => d.id === docId);
        if (docIndex !== -1) {
          // Update the doc in the list with new content only (don't change updatedAt to prevent shuffling)
          const updatedDocs = [...docs];
          updatedDocs[docIndex] = {
            ...updatedDocs[docIndex],
            content: formState.content,
            // Keep original updatedAt to maintain sort order
          };
          // Update the cache
          queryClient.setQueryData<Doc[]>(['docs', currentOrg.id], updatedDocs);
        }
      }
      
      // Also update the individual doc cache (without changing updatedAt)
      const currentDoc = queryClient.getQueryData<Doc>(['docs', docId, currentOrg.id]);
      if (currentDoc) {
        queryClient.setQueryData<Doc>(['docs', docId, currentOrg.id], {
          ...currentDoc,
          content: formState.content,
          // Keep original updatedAt to maintain sort order
        });
      }
    }
  }, [formState.content, docId, isNew, queryClient, currentOrg?.id]);

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

      // If this was a new doc, navigate to the created doc
      if (docId === "new" && savedDocId && savedDocId !== "new") {
        navigate(`/docs/${savedDocId}`, { replace: true });
        return; // Early return to avoid showing toast/tracking for new doc creation
      }

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
  // For new docs, show "Untitled" until user starts typing
  useEffect(() => {
    if (isNew) {
      // For new docs, show "Untitled" in context initially
      setContext("doc", { id: "new", title: "Untitled" });
    } else if (doc && docId && docId !== "new") {
      const title = extractFirstLineAsTitle(doc.content || doc.title || "", 100);
      if (title) {
        setContext("doc", { id: docId, title });
      } else {
        setContext("doc", { id: docId, title: "Untitled" });
      }
    } else {
      clearContext();
    }

    // Clear context on unmount
    return () => {
      clearContext();
    };
  }, [doc, docId, isNew, setContext, clearContext]);

  // Update page context title in real-time as user types (for new docs)
  useEffect(() => {
    if (isNew) {
      // For new docs, update context title as user types
      const title = extractedTitle;
      setContext("doc", { id: "new", title });
    }
  }, [isNew, extractedTitle, setContext]);

  // Fetch download URL when doc is loaded and is an uploaded file
  useEffect(() => {
    const fetchDownloadUrl = async () => {
      if (!doc || !doc.storagePath || doc.docType === 'rich_text') {
        return;
      }

      try {
        const response = await fetch(`/api/docs/${doc.id}/download`, {
          headers: {
            'Authorization': `Bearer ${await user?.getIdToken()}`,
            'x-org-slug': currentOrg?.slug || '',
          },
        });

        if (response.ok) {
          const data = await response.json();
          setDownloadUrl(data.downloadUrl);
        }
      } catch (error) {
        console.error('Failed to fetch download URL:', error);
      }
    };

    fetchDownloadUrl();
  }, [doc?.id, doc?.storagePath, doc?.docType]);

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

  const handleExportPDF = useCallback(async () => {
    console.log("PDF export triggered from DocDetail page");
    try {
      // Get the document title
      const docTitle = extractedTitle || "Document";

      // Get the content - use doc content if available, otherwise use formState
      const contentToExport = doc?.content || formState.content || "";
      console.log("Content to export available:", !!contentToExport, "length:", contentToExport.length);

      // Validate that there's actual content to export
      const isEmpty = !contentToExport ||
        !contentToExport.trim() ||
        contentToExport === '<p></p>' ||
        contentToExport === '{"type":"doc","content":[{"type":"paragraph"}]}' ||
        contentToExport === '{"type":"doc","content":[{"type":"paragraph","content":[]}]}' ||
        contentToExport.startsWith('{"type":"doc","content":[{"type":"paragraph"}]}');

      if (isEmpty) {
        toast({
          title: "Cannot Export Empty Document",
          description: "Please add some content to the document before exporting to PDF.",
          variant: "destructive",
        });
        return;
      }

      // Generate filename with timestamp
      const filename = generateFilenameWithTimestamp(
        docTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()
      );

      // Export to PDF
      await exportEditorToPDF(contentToExport, docTitle, filename);

      // Show success toast
      toast({
        title: "PDF Exported",
        description: `"${docTitle}" has been exported as PDF successfully.`,
      });

      // Track the export event
      trackEvent("doc_exported_pdf", {
        doc_id: docId,
        doc_title: docTitle,
      });
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export document as PDF",
        variant: "destructive",
      });
    }
  }, [doc?.content, formState.content, extractedTitle, docId, toast]);

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
            className="w-full max-w-full bg-background relative min-w-0 flex flex-col h-screen"
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
              onExportPDF={handleExportPDF}
              isOwner={isOwner}
              filesCount={files.length}
              isNew={isNew}
              doc={doc}
            />

            {/* Render appropriate viewer based on document type */}
            <div className="flex-1 overflow-hidden">
            {(() => {
              const docType = doc?.docType || 'rich_text';

              // For uploaded files (PDF, Word, Excel, PowerPoint), show file viewer
              if (docType === 'pdf') {
                return <PDFViewer doc={doc} downloadUrl={downloadUrl} />;
              }

              if (docType === 'docx' || docType === 'pptx' || docType === 'xlsx') {
                return <DocumentViewer doc={doc} downloadUrl={downloadUrl} />;
              }

              // For rich text documents, use the editor
              // Determine content to pass to editor
              let editorContent: string;

              if (isNew) {
                editorContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
              } else if (doc && doc.id === docId) {
                editorContent = doc.content || JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
              } else if (!isLoading && formState.content && formState.content !== JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })) {
                editorContent = formState.content;
              } else {
                editorContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
              }

              return (
                <RichTextEditor
                  key={editorKey}
                  content={editorContent}
                  onChange={(content) => {
                    const contentString = typeof content === "string" ? content : JSON.stringify(content);
                    updateField("content", contentString);
                  }}
                  placeholder="Start writing..."
                  readOnly={false}
                  onFileUpload={handleFileUpload}
                  onImageAdded={handleImageAdded}
                  docId={docId || undefined}
                  onSaveFirst={handleSaveFirst}
                />
              );
            })()}
            </div>
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
