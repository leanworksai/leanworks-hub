import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, MoreVertical, Pin, Trash2, Edit, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDocs, useDeleteDoc } from "@/hooks/useDocs";
import { useUsers } from "@/hooks/useUsers";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { trackClick, trackCreate, trackDelete, trackView } from "@/lib/analytics";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const truncateText = (html: string, maxLength: number) => {
  // Remove HTML tags for truncation
  const text = html.replace(/<[^>]*>/g, '');
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

export default function Docs() {
  const navigate = useNavigate();
  const { data: docs = [], isLoading } = useDocs();
  const { data: users = [] } = useUsers();
  const deleteDoc = useDeleteDoc();
  const { toast } = useToast();
  const [docToDelete, setDocToDelete] = useState<string | null>(null);

  // Helper function to get user display name from email
  const getUserDisplayName = (email: string): string => {
    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    return user?.name || user?.email || email;
  };

  // Helper function to get user avatar initials
  const getUserInitials = (email: string): string => {
    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (user?.name) {
      const names = user.name.split(' ');
      if (names.length >= 2) {
        return (names[0][0] + names[names.length - 1][0]).toUpperCase();
      }
      return user.name.substring(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
  };

  const handleDeleteClick = (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    trackClick('delete_doc', '/docs');
    setDocToDelete(docId);
  };

  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;

    try {
      await deleteDoc.mutateAsync(docToDelete);
      trackDelete('doc', docToDelete);
      const doc = docs.find(d => d.id === docToDelete);
      toast({
        title: "Doc deleted",
        description: `"${doc?.title || 'Doc'}" has been deleted successfully.`,
      });
      setDocToDelete(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete doc",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading docs...</p>
        </div>
      </div>
    );
  }

  // Separate pinned and unpinned docs
  const pinnedDocs = docs.filter(doc => doc.isPinned);
  const unpinnedDocs = docs.filter(doc => !doc.isPinned);

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Docs</h1>
        </div>
        <Button 
          className="w-full sm:w-auto"
          onClick={() => {
            trackClick('create_doc', '/docs');
            navigate("/docs/new");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Doc
        </Button>
      </div>

      {docs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-muted-foreground mb-4">No docs yet</p>
            <Button onClick={() => {
          trackClick('create_doc', '/docs');
          navigate("/docs/new");
        }}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first doc
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {pinnedDocs.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Pin className="h-4 w-4" />
                Pinned
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pinnedDocs.map((doc) => (
                  <Card
                    key={doc.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      trackView('doc', doc.id);
                      navigate(`/docs/${doc.id}`);
                    }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="line-clamp-2">{doc.title}</CardTitle>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}`)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => handleDeleteClick(e, doc.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mt-1 -mx-6 px-6">
                        <span>{format(new Date(doc.updatedAt), "MMM d, yyyy")}</span>
                        {doc.ownerEmail && (
                          <div className="flex items-center gap-1.5">
                            <Avatar className="h-4 w-4">
                              <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                                {getUserInitials(doc.ownerEmail)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium hidden sm:inline">{getUserDisplayName(doc.ownerEmail)}</span>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div
                        className="text-sm text-muted-foreground line-clamp-3 prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: truncateText(doc.content, 150) }}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {unpinnedDocs.length > 0 && (
            <div className="space-y-4">
              {pinnedDocs.length > 0 && (
                <h2 className="text-lg font-semibold">All Docs</h2>
              )}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {unpinnedDocs.map((doc) => (
                  <Card
                    key={doc.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      trackView('doc', doc.id);
                      navigate(`/docs/${doc.id}`);
                    }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="line-clamp-2">{doc.title}</CardTitle>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}`)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => handleDeleteClick(e, doc.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mt-1 -mx-6 px-6">
                        <span>{format(new Date(doc.updatedAt), "MMM d, yyyy")}</span>
                        {doc.ownerEmail && (
                          <div className="flex items-center gap-1.5">
                            <Avatar className="h-4 w-4">
                              <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                                {getUserInitials(doc.ownerEmail)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium hidden sm:inline">{getUserDisplayName(doc.ownerEmail)}</span>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div
                        className="text-sm text-muted-foreground line-clamp-3 prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: truncateText(doc.content, 150) }}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!docToDelete} onOpenChange={(open) => !open && setDocToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Doc</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this doc? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

