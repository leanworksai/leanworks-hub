import { FileText, FileSpreadsheet, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocItemMenu } from "./DocItemMenu";
import type { Doc } from "@/data/docsData";
import { useIsMobile } from "@/hooks/use-mobile";

interface DocItemProps {
  doc: Doc;
  isActive: boolean;
  isOwner: boolean;
  title: string;
  onDocClick: (docId: string) => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function DocItem({
  doc,
  isActive,
  isOwner,
  title,
  onDocClick,
  onDelete,
}: DocItemProps) {
  const filesCount = doc.metadata?.files?.length || 0;
  const isMobile = useIsMobile();

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer",
        isActive && "bg-accent text-accent-foreground"
      )}
      onClick={() => onDocClick(doc.id)}
    >
{(() => {
  const getDocIcon = () => {
    switch (doc.docType) {
      case 'pdf':
        return <FileText className="text-red-500" />;
      case 'docx':
        return <FileText className="text-blue-500" />;
      case 'pptx':
        return <Presentation className="text-orange-500" />;
      case 'xlsx':
        return <FileSpreadsheet className="text-green-500" />;
      default:
        return <FileText className={isActive ? "text-primary" : "text-muted-foreground"} />;
    }
  };

  const Icon = getDocIcon();
  return (
    <Icon.type
      {...Icon.props}
      className={cn(
        "h-3.5 w-3.5 mt-0.5 flex-shrink-0",
        Icon.props.className
      )}
    />
  );
})()}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <p
          className={cn(
            "text-sm font-medium truncate leading-tight flex-1 min-w-0",
            isActive ? "text-foreground" : "text-foreground/80"
          )}
        >
          {title || "Untitled Doc"}
        </p>
        {/* Hide menu on mobile - clicking title directly navigates to doc */}
        {!isMobile && (
          <div className="w-5 flex-shrink-0">
            <DocItemMenu
              doc={doc}
              isActive={isActive}
              isOwner={isOwner}
              filesCount={filesCount}
              onDelete={onDelete}
            />
          </div>
        )}
      </div>
    </div>
  );
}
