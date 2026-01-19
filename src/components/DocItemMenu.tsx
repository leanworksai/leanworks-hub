import { Button } from "@/components/ui/button";
import { MoreVertical, Share2, Mail, Paperclip, Trash2, Plus, X, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
import type { Doc } from "@/data/docsData";
import { exportEditorToPDF, generateFilenameWithTimestamp, convertJsonToHtml } from "@/utils/pdfExport";
import { useToast } from "@/components/ui/use-toast";

interface DocItemMenuProps {
  doc: Doc;
  isActive: boolean;
  isOwner: boolean;
  filesCount: number;
  onDelete: (e: React.MouseEvent) => void;
}

export function DocItemMenu({
  doc,
  isActive,
  isOwner,
  filesCount,
  onDelete,
}: DocItemMenuProps) {
  const navigate = useNavigate();
  const { toggleDoc, isDocSelected } = useSelectedDocs();
  const isSelected = isDocSelected(doc.id);
  const { toast } = useToast();

  const handleExportPDF = async (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("PDF export triggered for doc:", doc.title);
    try {
      // Use the document content from props instead of DOM scraping
      const jsonContent = doc.content;
      console.log("Document JSON content available:", !!jsonContent, "length:", jsonContent?.length);

      if (!jsonContent || jsonContent.trim() === '') {
        console.log("No content available, navigating to detail page for export");
        // If there's no content in the document data, navigate to detail page
        // where the user can load and export the full content
        navigate(`/docs/${doc.id}?action=export`);
        return;
      }

      // Convert JSON content to HTML
      console.log("Converting JSON content to HTML...");
      const htmlContent = await convertJsonToHtml(jsonContent);
      console.log("HTML content generated, length:", htmlContent?.length);

      if (!htmlContent || htmlContent.trim() === '') {
        console.log("Generated HTML is empty, navigating to detail page for export");
        navigate(`/docs/${doc.id}?action=export`);
        return;
      }

      console.log("Found HTML content, calling exportEditorToPDF");

      // Generate filename with timestamp
      const docTitle = doc.title || "document";
      const filename = generateFilenameWithTimestamp(
        docTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()
      );
      console.log("Generated filename:", filename);

      await exportEditorToPDF(htmlContent, docTitle, filename);
      toast({
        title: "Success",
        description: `"${docTitle}" exported as PDF`,
      });
    } catch (error) {
      console.error("PDF export failed:", error);
      toast({
        title: "Error",
        description: "Failed to export PDF. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 w-6 p-0 invisible group-hover:visible flex-shrink-0",
            isActive && "visible"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={(e) => {
          e.stopPropagation();
          toggleDoc(doc);
        }}>
          {isSelected ? (
            <>
              <X className="mr-2 h-4 w-4" />
              Remove from Context
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add to Context
            </>
          )}
        </DropdownMenuItem>
        {isOwner && (
          <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}?action=share`)}>
            <Share2 className="mr-2 h-4 w-4" />
            Limit Visibility
          </DropdownMenuItem>
        )}
        {isOwner && (
          <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}?action=shareEmail`)}>
            <Mail className="mr-2 h-4 w-4" />
            Share
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => navigate(`/docs/${doc.id}?action=files`)}>
          <Paperclip className="mr-2 h-4 w-4" />
          Attached Files {filesCount > 0 && `(${filesCount})`}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPDF}>
          <Download className="mr-2 h-4 w-4" />
          Export as PDF
        </DropdownMenuItem>
        {isOwner && (
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
