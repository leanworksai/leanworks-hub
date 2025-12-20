import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useDoc, useCreateDoc, useUpdateDoc } from "@/hooks/useDocs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Share2, Edit } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/AuthContext";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";

export default function DocDetail() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = docId === "new";
  const { data: doc, isLoading } = useDoc(docId || "");
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [visibility, setVisibility] = useState<'all_members' | 'specific_members'>('all_members');
  const [visibleToMembers, setVisibleToMembers] = useState<Set<string>>(new Set());
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  // Check if edit query parameter is present, otherwise default to read-only for existing docs
  const shouldStartInEditMode = searchParams.get('edit') === 'true' || isNew;
  const [isEditMode, setIsEditMode] = useState(shouldStartInEditMode);

  // Load doc data when editing
  useEffect(() => {
    if (doc && !isNew) {
      setTitle(doc.title || "");
      // Preserve content even if it's empty string, only default to empty if it's null/undefined
      setContent(doc.content !== null && doc.content !== undefined ? doc.content : "");
      setVisibility(doc.visibility || 'all_members');
      // Ensure visibleToMembers is always an array before creating Set
      const membersArray = Array.isArray(doc.visibleToMembers) ? doc.visibleToMembers : [];
      setVisibleToMembers(new Set(membersArray));
      // Set edit mode based on query parameter, default to read-only
      const shouldEdit = searchParams.get('edit') === 'true';
      setIsEditMode(shouldEdit);
    } else if (isNew) {
      // Reset form for new doc
      setTitle("");
      setContent("");
      setVisibility('all_members');
      setVisibleToMembers(new Set());
      // New docs start in edit mode
      setIsEditMode(true);
    }
  }, [doc, isNew, searchParams]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast({
        title: "Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    if (!content.trim() || content === "<p></p>") {
      toast({
        title: "Error",
        description: "Content is required",
        variant: "destructive",
      });
      return;
    }

    // Validate specific_members visibility
    if (visibility === 'specific_members' && visibleToMembers.size === 0) {
      toast({
        title: "Error",
        description: "Please select at least one member when visibility is set to 'Specific Members'",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    try {
      if (isNew) {
        const newDoc = {
          id: uuidv4(),
          title: title.trim(),
          content,
          ownerEmail: user?.email || "",
          projectId: null,
          teamId: null,
          visibility,
          visibleToMembers: Array.from(visibleToMembers),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const createdDoc = await createDoc.mutateAsync(newDoc);
        toast({
          title: "Doc created",
          description: `"${createdDoc.title}" has been created successfully.`,
        });
        navigate('/docs');
      } else if (docId) {
        await updateDoc.mutateAsync({
          docId,
          updates: {
            title: title.trim(),
            content,
            visibility,
            visibleToMembers: Array.from(visibleToMembers),
          },
        });
        toast({
          title: "Doc updated",
          description: `"${title}" has been updated successfully.`,
        });
        navigate('/docs');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save doc",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
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
    <div className="space-y-4 sm:space-y-6 animate-fade-in max-w-full overflow-x-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/docs")} className="self-start">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          {!isNew && doc && user?.email?.toLowerCase() === doc.ownerEmail?.toLowerCase() && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShareDialogOpen(true)}
              className="flex-1 sm:flex-initial"
            >
              <Share2 className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Limit Visibility</span>
              <span className="sm:hidden">Visibility</span>
            </Button>
          )}
          {isEditMode ? (
            <Button onClick={handleSave} disabled={isSaving} className="flex-1 sm:flex-initial">
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
          ) : (
            <Button onClick={() => setIsEditMode(true)} className="flex-1 sm:flex-initial">
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {(!isNew && isLoading && !doc) ? (
        <div className="min-h-[500px] border rounded-lg flex items-center justify-center">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      ) : (
        <RichTextEditor 
          key={docId || "new"}
          content={content || ""} 
          onChange={setContent}
          title={title}
          onTitleChange={setTitle}
          titlePlaceholder="Doc title..."
          readOnly={!isEditMode}
        />
      )}

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
    </div>
  );
}

