import { FileText, FileSpreadsheet, Presentation, Folder, ChevronRight, ChevronDown } from "lucide-react";
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
  isExpanded?: boolean;
  hasChildren?: boolean;
  level?: number;
}

export function DocItem({
  doc,
  isActive,
  isOwner,
  title,
  onDocClick,
  onDelete,
  isExpanded = false,
  hasChildren = false,
  level = 0,
}: DocItemProps) {
  const isMobile = useIsMobile();

  const getDocIcon = () => {
    if (doc.isFolder) {
      return <Folder className={isActive ? "text-primary" : "text-muted-foreground"} />;
    }

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

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer",
        isActive && "bg-accent text-accent-foreground"
      )}
      style={{ paddingLeft: `${0.5 + level * 1}rem` }}
      onClick={() => onDocClick(doc.id)}
    >
      {/* Chevron for folders */}
      {doc.isFolder && (
        <div className="flex-shrink-0 w-3 h-3 flex items-center justify-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          ) : null}
        </div>
      )}

      {/* Icon */}
      {(() => {
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
            isActive ? "text-foreground" : "text-foreground/80",
            doc.isFolder && "font-semibold"
          )}
        >
          {title || (doc.isFolder ? "Untitled Folder" : "Untitled Doc")}
        </p>
        {/* Hide menu on mobile - clicking title directly navigates to doc */}
        {!isMobile && (
          <div className="w-5 flex-shrink-0">
            <DocItemMenu
              doc={doc}
              isActive={isActive}
              isOwner={isOwner}
              onDelete={onDelete}
            />
          </div>
        )}
      </div>
    </div>
  );
}
