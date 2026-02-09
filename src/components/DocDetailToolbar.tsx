import { Button } from "@/components/ui/button";
import { ArrowLeft, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DocToolbar } from "./DocToolbar";
import { createDocActions } from "@/utils/docUtils";

interface DocDetailToolbarProps {
  onBack: () => void;
  onShare: () => void;
  onShareViaEmail: () => void;
  onDelete: () => void;
  onExportPDF?: () => void;
  isOwner: boolean;
  isNew: boolean;
  doc: { id: string } | null | undefined;
}

export function DocDetailToolbar({
  onBack,
  onShare,
  onShareViaEmail,
  onDelete,
  onExportPDF,
  isOwner,
  isNew,
  doc,
}: DocDetailToolbarProps) {
  return (
    <>
      {/* Desktop Toolbar */}
      <div className="hidden sm:block mb-4">
        <DocToolbar
          onBack={onBack}
          onShare={onShare}
          onShareViaEmail={onShareViaEmail}
          onDelete={onDelete}
          isOwner={isOwner}
          isNew={isNew}
        />
      </div>

      {/* Mobile header - back button and menu (always visible) */}
      <div className="sticky top-0 z-30 sm:hidden bg-background border-b border-border/30 px-2 py-1 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="hover:bg-muted/50 h-8 w-8 p-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {!isNew && !!doc && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {createDocActions(isOwner, {
                onShare,
                onShareViaEmail,
                onDelete,
                onExportPDF,
              }).map((action, index) => (
                <DropdownMenuItem
                  key={index}
                  onClick={action.onClick}
                  className={
                    action.destructive
                      ? "text-destructive focus:text-destructive"
                      : ""
                  }
                >
                  {action.icon && <span className="mr-2">{action.icon}</span>}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </>
  );
}
