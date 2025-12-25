import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, MoreVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface DetailPageHeaderAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

interface DetailPageHeaderProps {
  title: string;
  onTitleChange?: (title: string) => void;
  onTitleBlur?: () => void;
  onTitleKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  isEditingTitle?: boolean;
  titleClassName?: string;
  backHref: string;
  actions?: DetailPageHeaderAction[];
  showActions?: boolean;
  className?: string;
  isDialog?: boolean;
  onBack?: () => void;
  onTitleClick?: () => void;
  titleElement?: React.ReactNode;
  hideTitle?: boolean; // Hide the title section (useful when title is rendered elsewhere, like in RichTextEditor)
}

export function DetailPageHeader({
  title,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  isEditingTitle = false,
  titleClassName,
  backHref,
  actions = [],
  showActions = true,
  className,
  isDialog = false,
  onBack,
  onTitleClick,
  titleElement,
  hideTitle = false,
}: DetailPageHeaderProps) {
  const navigate = useNavigate();
  
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(backHref);
    }
  };

  return (
    <>
      {/* Mobile buttons at top */}
      {!isDialog && (
        <div className="flex sm:hidden items-center justify-between mb-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleBack}
            className="hover:bg-muted/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {showActions && actions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((action, index) => (
                  <DropdownMenuItem
                    key={index}
                    onClick={action.onClick}
                    className={action.destructive ? "text-destructive focus:text-destructive" : ""}
                  >
                    {action.icon && <span className="mr-2 h-4 w-4">{action.icon}</span>}
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Title with desktop actions */}
      {!hideTitle && (
        <div className={cn("flex items-center gap-2 w-full mb-3", className)}>
          <div className="flex-1 min-w-0">
            {titleElement ? (
              titleElement
            ) : isEditingTitle && onTitleChange ? (
              <Input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                onBlur={onTitleBlur}
                onKeyDown={onTitleKeyDown}
                autoFocus
                className={cn(
                  "text-2xl sm:text-3xl font-bold h-auto py-2",
                  titleClassName
                )}
              />
            ) : (
              <h1 
                className={cn(
                  "text-2xl sm:text-3xl font-bold tracking-tight flex-1 min-w-0",
                  onTitleClick && "cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors",
                  titleClassName
                )}
                onClick={onTitleClick}
              >
                {title}
              </h1>
            )}
          </div>
          {!isDialog && (
            <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleBack}
                className="hover:bg-muted/50"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {showActions && actions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {actions.map((action, index) => (
                      <DropdownMenuItem
                        key={index}
                        onClick={action.onClick}
                        className={action.destructive ? "text-destructive focus:text-destructive" : ""}
                      >
                        {action.icon && <span className="mr-2 h-4 w-4">{action.icon}</span>}
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

