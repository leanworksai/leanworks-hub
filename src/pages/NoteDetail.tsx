import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useNote, useCreateNote, useUpdateNote } from "@/hooks/useNotes";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Pin, PinOff } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/AuthContext";

export default function NoteDetail() {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const isNew = noteId === "new";
  const { data: note, isLoading } = useNote(noteId || "");
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load note data when editing
  useEffect(() => {
    if (note && !isNew) {
      setTitle(note.title || "");
      // Preserve content even if it's empty string, only default to empty if it's null/undefined
      setContent(note.content !== null && note.content !== undefined ? note.content : "");
      setIsPinned(note.isPinned || false);
    } else if (isNew) {
      // Reset form for new note
      setTitle("");
      setContent("");
      setIsPinned(false);
    }
  }, [note, isNew]);

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

    setIsSaving(true);

    try {
      if (isNew) {
        const newNote = {
          id: uuidv4(),
          title: title.trim(),
          content,
          ownerEmail: user?.email || "",
          projectId: null,
          teamId: null,
          isPinned,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await createNote.mutateAsync(newNote);
        toast({
          title: "Note created",
          description: `"${newNote.title}" has been created successfully.`,
        });
        navigate(`/notes/${newNote.id}`);
      } else if (noteId) {
        await updateNote.mutateAsync({
          noteId,
          updates: {
            title: title.trim(),
            content,
            isPinned,
          },
        });
        toast({
          title: "Note updated",
          description: `"${title}" has been updated successfully.`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save note",
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
          <p className="text-muted-foreground">Loading note...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/notes")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPinned(!isPinned)}
            className={isPinned ? "bg-accent" : ""}
          >
            {isPinned ? (
              <>
                <PinOff className="mr-2 h-4 w-4" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="mr-2 h-4 w-4" />
                Pin
              </>
            )}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {(!isNew && isLoading && !note) ? (
        <div className="min-h-[500px] border rounded-lg flex items-center justify-center">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      ) : (
        <RichTextEditor 
          key={noteId || "new"}
          content={content || ""} 
          onChange={setContent}
          title={title}
          onTitleChange={setTitle}
          titlePlaceholder="Note title..."
        />
      )}
    </div>
  );
}

