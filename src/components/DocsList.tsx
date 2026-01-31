import { Button } from "@/components/ui/button";
import { Plus, FileText, Upload } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDocs, useCreateDoc } from "@/hooks/useDocs";
import { trackClick, trackView } from "@/lib/analytics";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { isDocOwner } from "@/utils/docUtils";
import { useDeleteDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { DocItem } from "./DocItem";
import { DocumentUploadDialog } from "./DocumentUploadDialog";
import type { Doc } from "@/data/docsData";
import { v4 as uuidv4 } from "uuid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";

type DocsListVariant = "sidebar" | "catalog";

interface DocsListProps {
  variant?: DocsListVariant;
}

export function DocsList({ variant = "sidebar" }: DocsListProps) {
  const navigate = useNavigate();
  const { docId: activeDocId } = useParams<{ docId: string }>();
  const { data: docs = [], isLoading } = useDocs();
  const { user } = useAuth();
  const deleteDoc = useDeleteDoc();
  const createDoc = useCreateDoc();
  const { toast } = useToast();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // Sort docs by created at desc (newest first)
  const sortedDocs = [...docs].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const handleCreateDoc = async () => {
    trackClick('create_doc', '/docs');
    
    if (!user?.email) {
      toast({
        title: "Error",
        description: "You must be logged in to create a document",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create the doc immediately with empty content and "Untitled" title
      // Use default TipTap empty structure for valid JSON
      const emptyTipTapContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
      const newDoc: Doc = {
        id: uuidv4(),
        title: "Untitled",
        content: emptyTipTapContent,
        ownerEmail: user.email,
        projectId: null,
        teamId: null,
        visibility: 'all_members',
        visibleToMembers: [],
        metadata: { files: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const createdDoc = await createDoc.mutateAsync(newDoc);
      
      // Navigate to the created doc
      navigate(`/docs/${createdDoc.id}`);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create document",
        variant: "destructive",
      });
    }
  };

  const handleDocClick = (docId: string) => {
    trackView('doc', docId);
    navigate(`/docs/${docId}`);
  };

  const performDeleteDoc = async (doc: typeof docs[0], e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking delete
    // For uploaded files, use doc.title directly. For rich_text, extract from content.
    const docType = doc.docType || 'rich_text';
    const docTitle = docType !== 'rich_text' 
      ? (doc.title || "this doc")
      : (extractFirstLineAsTitle(doc.content || doc.title || "", 50) || "this doc");
    if (window.confirm(`Are you sure you want to delete "${docTitle}"?`)) {
      try {
        await deleteDoc.mutateAsync(doc.id);
        toast({
          title: "Doc deleted",
          description: "Document has been deleted successfully.",
        });
      } catch (error) {
        toast({
          title: "Error",
          description:
            error instanceof Error ? error.message : "Failed to delete doc",
          variant: "destructive",
        });
      }
    }
  };

  if (isLoading) {
    if (variant === "sidebar") {
      return (
        <div className="w-64 border-r border-border bg-card/50 p-4 space-y-4 flex flex-col">
          <div className="h-8 bg-muted/50 rounded animate-pulse" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full p-4">
        <div className="h-8 bg-muted/50 rounded animate-pulse mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <div className="w-64 border-r border-border bg-card/30 flex flex-col h-full flex-shrink-0 hidden md:flex">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Docs</h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleCreateDoc}>
                  <FileText className="h-4 w-4 mr-2" />
                  Create a blank page
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUploadDialogOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload a file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <DocumentUploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
        />

        <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
          {docs.length === 0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-muted-foreground mb-4">No docs yet</p>
            </div>
          ) : (
            sortedDocs.map((doc) => {
              const isActive = doc.id === activeDocId;
              // For uploaded files, use doc.title directly. For rich_text, extract from content.
              const docType = doc.docType || 'rich_text';
              const title = docType !== 'rich_text'
                ? (doc.title || "Untitled")
                : (extractFirstLineAsTitle(doc.content || doc.title || "", 50) || "Untitled");
              const docIsOwner = isDocOwner(user?.email, doc.ownerEmail);

              return (
                <DocItem
                  key={doc.id}
                  doc={doc}
                  isActive={isActive}
                  isOwner={docIsOwner}
                  title={title}
                  onDocClick={handleDocClick}
                  onDelete={(e) => performDeleteDoc(doc, e)}
                />
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Catalog variant
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-1.5 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Docs</h2>
          <Button 
            size="sm" 
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={handleCreateDoc}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {docs.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-muted-foreground mb-4">No docs yet</p>
          </div>
        ) : (
          sortedDocs.map((doc) => {
            const isActive = doc.id === activeDocId;
            // For uploaded files, use doc.title directly. For rich_text, extract from content.
            const docType = doc.docType || 'rich_text';
            const title = docType !== 'rich_text'
              ? (doc.title || "Untitled")
              : (extractFirstLineAsTitle(doc.content || doc.title || "", 50) || "Untitled");
            const docIsOwner = isDocOwner(user?.email, doc.ownerEmail);

            return (
              <DocItem
                key={doc.id}
                doc={doc}
                isActive={isActive}
                isOwner={docIsOwner}
                title={title}
                onDocClick={handleDocClick}
                onDelete={(e) => performDeleteDoc(doc, e)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
