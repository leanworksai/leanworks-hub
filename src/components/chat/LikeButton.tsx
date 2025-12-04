import { ThumbsUp } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LikedByUser } from "./types";

interface LikeButtonProps {
  likes: string[];
  currentUserEmail: string;
  onToggle: () => void;
  getLikedByUsers: (likes: string[]) => LikedByUser[];
  position: "left" | "right";
  showOnHover?: boolean;
}

export function LikeButton({
  likes,
  currentUserEmail,
  onToggle,
  getLikedByUsers,
  position,
  showOnHover = false,
}: LikeButtonProps) {
  const hasLikes = likes && likes.length > 0;
  const isLikedByCurrentUser = likes?.includes(currentUserEmail.toLowerCase());
  const likedByUsers = hasLikes ? getLikedByUsers(likes) : [];

  // If no likes and not showing on hover, render nothing
  if (!hasLikes && !showOnHover) {
    return null;
  }

  // Show on hover state (no likes yet)
  if (!hasLikes && showOnHover) {
    return (
      <div
        className={cn(
          "absolute top-0 flex items-start opacity-0 group-hover:opacity-100 transition-opacity z-10",
          position === "left" ? "-left-8" : "-right-8"
        )}
      >
        <button
          onClick={onToggle}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors shadow-md bg-background border border-border whitespace-nowrap text-muted-foreground hover:bg-muted"
        >
          <ThumbsUp className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // Has likes state
  return (
    <div
      className={cn(
        "absolute top-0 flex items-start z-10",
        position === "left" ? "-left-8" : "-right-8"
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggle}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors shadow-md bg-background border border-border whitespace-nowrap",
              isLikedByCurrentUser
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <ThumbsUp
              className={cn(
                "h-3 w-3",
                isLikedByCurrentUser && "fill-current text-red-500"
              )}
            />
            <span>{likes.length}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={position === "left" ? "left" : "right"}
          className="max-w-xs"
        >
          <div className="space-y-1">
            <div className="text-xs font-semibold mb-1">
              {likes.length === 1 ? "Liked by" : `Liked by ${likes.length} people`}
            </div>
            <div className="space-y-0.5">
              {likedByUsers.map((likedUser, idx) => (
                <div key={idx} className="text-xs flex items-center gap-2">
                  <Avatar className="h-4 w-4">
                    <AvatarFallback className="text-[10px] bg-primary/10">
                      {likedUser.initials}
                    </AvatarFallback>
                  </Avatar>
                  <span>{likedUser.name}</span>
                </div>
              ))}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

