import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDocs } from "@/hooks/useDocs";
import { trackClick, trackView } from "@/lib/analytics";
import { extractFirstLineAsTitle } from "@/utils/contentUtils";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { isDocOwner } from "@/utils/docUtils";
import { useDeleteDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { DocItem } from "./DocItem";

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
  const { toast } = useToast();

  // Sort docs by updated at desc
  const sortedDocs = [...docs].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const handleCreateDoc = () => {
    trackClick('create_doc', '/docs');
    navigate("/docs/new");
  };

  const handleDocClick = (docId: string) => {
    trackView('doc', docId);
    navigate(`/docs/${docId}`);
  };

  const performDeleteDoc = async (doc: typeof docs[0], e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking delete
    const docTitle =
      extractFirstLineAsTitle(doc.content || doc.title || "", 50) || "this doc";
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
            <Button 
              size="sm" 
              variant="ghost"
              className="h-8 w-8 p-0"
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
              <Button 
                size="sm"
                variant="outline"
                className="w-full"
                onClick={handleCreateDoc}
              >
                <Plus className="mr-2 h-4 w-4" />
                New Doc
              </Button>
            </div>
          ) : (
            sortedDocs.map((doc) => {
              const isActive = doc.id === activeDocId;
              const title = extractFirstLineAsTitle(
                doc.content || doc.title || "",
                50
              );
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
            <Button 
              size="sm"
              variant="outline"
              className="w-full"
              onClick={handleCreateDoc}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Doc
            </Button>
          </div>
        ) : (
          sortedDocs.map((doc) => {
            const isActive = doc.id === activeDocId;
            const title = extractFirstLineAsTitle(
              doc.content || doc.title || "",
              50
            );
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
