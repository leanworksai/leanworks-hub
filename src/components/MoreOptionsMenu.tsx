import React, { memo } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LucideIcon } from "lucide-react";

export interface MoreOptionsMenuItem {
  icon?: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  isDestructive?: boolean;
  show?: boolean;
  className?: string;
}

interface MoreOptionsMenuProps {
  items: MoreOptionsMenuItem[];
  size?: "icon" | "sm";
  align?: "start" | "end" | "center";
  onTriggerClick?: (e: React.MouseEvent) => void;
}

function MoreOptionsMenuComponent({
  items,
  size = "icon",
  align = "end",
  onTriggerClick,
}: MoreOptionsMenuProps) {
  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTriggerClick?.(e);
  };

  const handleItemClick = (itemOnClick: (e: React.MouseEvent) => void) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      itemOnClick(e);
    };
  };

  const visibleItems = items.filter((item) => item.show !== false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          className="data-[state=open]:bg-accent/50 data-[state=open]:border-primary/20 data-[state=open]:border data-[state=open]:text-foreground"
          onClick={handleTriggerClick}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      {visibleItems.length > 0 && (
        <DropdownMenuContent align={align}>
          {visibleItems.map((item, index) => (
            <DropdownMenuItem
              key={index}
              onClick={handleItemClick(item.onClick)}
              className={
                item.isDestructive
                  ? "text-foreground focus:text-accent-foreground data-[highlighted]:text-accent-foreground"
                  : item.className
              }
            >
              {item.icon && <item.icon className="mr-2 h-4 w-4" />}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

export const MoreOptionsMenu = memo(MoreOptionsMenuComponent);
