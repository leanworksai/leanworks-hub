import { useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react";
import { X, Send, Image as ImageIcon, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, getAvatarColor } from "@/lib/utils";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";
import { CitedContext, TeamMember } from "./types";
import { Project } from "@/data/projectsData";
import { Task } from "@/data/tasksData";
import { Team } from "@/data/teamsData";
import { Doc } from "@/data/docsData";
import { ContextBadges } from "@/components/ContextBadges";

export interface ChatInputProps {
  onSend: (message: string, imageUrls: string[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  uploadingImages?: boolean;
  
  // Mentions
  showMentions?: boolean;
  mentionUsers?: TeamMember[];
  onMentionDetect?: (value: string, cursorPos: number) => void;
  showMentionSuggestions?: boolean;
  filteredMentionUsers?: TeamMember[];
  selectedMentionIndex?: number;
  onMentionSelect?: (user: TeamMember) => void;
  onMentionIndexChange?: (index: number) => void;
  onMentionClose?: () => void;
  
  // Cited context
  selectedProjects?: Project[];
  selectedTasks?: Task[];
  selectedTeams?: Team[];
  selectedDocs?: Doc[];
  onRemoveProject?: (project: Project) => void;
  onRemoveTask?: (task: Task) => void;
  onRemoveTeam?: (team: Team) => void;
  onRemoveDoc?: (doc: Doc) => void;
  
  // Image handling
  imagePreviewUrls?: string[];
  onImageSelect?: (e: ChangeEvent<HTMLInputElement>) => void;
  onImageRemove?: (index: number) => void;
  
  // Placeholder
  placeholder?: string;
  helpText?: string;
  
  // Hide context badges
  hideContext?: boolean;
  
  // Theme variant
  theme?: "default" | "purple";
}

export function ChatInput({
  onSend,
  disabled = false,
  isLoading = false,
  uploadingImages = false,
  showMentions = false,
  mentionUsers = [],
  onMentionDetect,
  showMentionSuggestions = false,
  filteredMentionUsers = [],
  selectedMentionIndex = 0,
  onMentionSelect,
  onMentionIndexChange,
  onMentionClose,
  selectedProjects = [],
  selectedTasks = [],
  selectedTeams = [],
  selectedDocs = [],
  onRemoveProject,
  onRemoveTask,
  onRemoveTeam,
  onRemoveDoc,
  imagePreviewUrls = [],
  onImageSelect,
  onImageRemove,
  placeholder = "Type your message...",
  helpText,
  hideContext = false,
  theme = "default",
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if (!input.trim() && imagePreviewUrls.length === 0) return;
    onSend(input.trim(), imagePreviewUrls);
    setInput("");
  }, [input, imagePreviewUrls, onSend]);

  const handleKeyPress = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !showMentionSuggestions) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, showMentionSuggestions]);

  const insertMention = useCallback((user: TeamMember) => {
    const beforeMention = input.substring(0, mentionCursorPos);
    const afterCursor = input.substring(inputRef.current?.selectionStart || input.length);
    // Extract first name only (everything before the first space)
    const firstName = user.name.split(' ')[0];
    const newInput = `${beforeMention}@${firstName} ${afterCursor}`;
    setInput(newInput);
    onMentionClose?.();
    
    // Focus input and move cursor after mention
    setTimeout(() => {
      inputRef.current?.focus();
      const newCursorPos = beforeMention.length + firstName.length + 2; // +2 for @ and space
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [input, mentionCursorPos, onMentionClose]);

  const handleMentionKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!showMentionSuggestions || filteredMentionUsers.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onMentionIndexChange?.((selectedMentionIndex + 1) % filteredMentionUsers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onMentionIndexChange?.(
        selectedMentionIndex > 0 ? selectedMentionIndex - 1 : filteredMentionUsers.length - 1
      );
    } else if (e.key === 'Enter' && showMentionSuggestions) {
      e.preventDefault();
      const selectedUser = filteredMentionUsers[selectedMentionIndex];
      if (selectedUser) {
        insertMention(selectedUser);
        onMentionSelect?.(selectedUser);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onMentionClose?.();
    }
  }, [showMentionSuggestions, filteredMentionUsers, selectedMentionIndex, onMentionIndexChange, onMentionSelect, onMentionClose, insertMention]);

  const insertEmoji = useCallback((emojiData: EmojiClickData) => {
    const cursorPos = inputRef.current?.selectionStart || input.length;
    const newValue = input.slice(0, cursorPos) + emojiData.emoji + input.slice(cursorPos);
    setInput(newValue);
    setShowEmojiPicker(false);
    
    // Focus and set cursor position after emoji
    setTimeout(() => {
      inputRef.current?.focus();
      const newCursorPos = cursorPos + emojiData.emoji.length;
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [input]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (showMentions && onMentionDetect) {
      const cursorPos = e.target.selectionStart || 0;
      onMentionDetect(e.target.value, cursorPos);
      // Track mention cursor position for insertion
      const textBeforeCursor = e.target.value.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      if (lastAtIndex !== -1) {
        const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
        if (charBeforeAt === ' ' || lastAtIndex === 0) {
          const afterAt = textBeforeCursor.substring(lastAtIndex + 1);
          if (!afterAt.includes(' ')) {
            setMentionCursorPos(lastAtIndex);
          }
        }
      }
    }
  }, [showMentions, onMentionDetect]);

  const handleInputClick = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (showMentions && onMentionDetect) {
      const cursorPos = (e.target as HTMLInputElement).selectionStart || 0;
      onMentionDetect(input, cursorPos);
      // Track mention cursor position
      const textBeforeCursor = input.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      if (lastAtIndex !== -1) {
        const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
        if (charBeforeAt === ' ' || lastAtIndex === 0) {
          const afterAt = textBeforeCursor.substring(lastAtIndex + 1);
          if (!afterAt.includes(' ')) {
            setMentionCursorPos(lastAtIndex);
          }
        }
      }
    }
  }, [showMentions, onMentionDetect, input]);

  return (
    <div className={cn(
      "border-t",
      theme === "purple" ? "bg-purple-50 border-purple-200" : "bg-background"
    )}>
      {!hideContext && (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0 || selectedDocs.length > 0) && (
        <div className="px-4 pt-3 pb-2">
          <ContextBadges
            projects={selectedProjects}
            tasks={selectedTasks}
            teams={selectedTeams}
            docs={selectedDocs}
            onRemoveProject={onRemoveProject}
            onRemoveTask={onRemoveTask}
            onRemoveTeam={onRemoveTeam}
            onRemoveDoc={onRemoveDoc}
            variant="inline"
          />
        </div>
      )}
      
      <div className="px-4 py-3 relative">
        {/* Image Preview Section */}
        {imagePreviewUrls.length > 0 && (
          <div className="mb-3 flex gap-2 flex-wrap">
            {imagePreviewUrls.map((url, index) => (
              <div key={index} className="relative group">
                <img
                  src={url}
                  alt={`Preview ${index + 1}`}
                  className="h-20 w-20 object-cover rounded-md border"
                />
                <button
                  onClick={() => onImageRemove?.(index)}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload Progress Indicator */}
        {uploadingImages && (
          <div className="mb-3 text-sm text-muted-foreground">
            Uploading images...
          </div>
        )}

        {/* Mention Suggestions Dropdown */}
        {showMentionSuggestions && filteredMentionUsers.length > 0 && showMentions && (
          <div className="absolute bottom-full left-4 right-4 mb-2 z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md max-h-60 overflow-auto">
            <div className="space-y-0.5">
              {filteredMentionUsers.map((user, index) => (
                <div
                  key={user.id}
                  onClick={() => {
                    insertMention(user);
                    onMentionSelect?.(user);
                  }}
                  onMouseEnter={() => onMentionIndexChange?.(index)}
                  className={cn(
                    "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                    index === selectedMentionIndex 
                      ? "bg-accent text-accent-foreground" 
                      : "focus:bg-accent focus:text-accent-foreground"
                  )}
                >
                  <Avatar className="h-6 w-6 shrink-0 mr-2">
                    {user.avatar?.startsWith('/') ? (
                      <>
                        <AvatarImage src={user.avatar} alt={user.name} className="object-contain" />
                        <AvatarFallback className={cn("text-xs", getAvatarColor((user.email || user.id)?.toLowerCase()))}>
                          {user.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </>
                    ) : (
                      <AvatarFallback className={cn("text-xs", getAvatarColor((user.email || user.id)?.toLowerCase()))}>
                        {user.avatar}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium truncate">{user.name}</span>
                    {user.role && (
                      <span className="text-xs text-muted-foreground truncate">{user.role}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all",
          theme === "purple" 
            ? "bg-purple-100 border border-purple-300 focus-within:border-purple-400 focus-within:ring-1 focus-within:ring-purple-300/30"
            : "bg-muted/50 border border-border/50 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
        )}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={onImageSelect}
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            multiple
            className="hidden"
          />
          <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isLoading || uploadingImages}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background/50"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 border-0" align="start" side="top">
              <EmojiPicker
                onEmojiClick={insertEmoji}
                autoFocusSearch={false}
                theme="light"
                width={350}
                height={400}
              />
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            variant="ghost"
            size="icon"
            disabled={isLoading || uploadingImages}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background/50"
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          <Input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleMentionKeyDown}
            onKeyPress={handleKeyPress}
            onClick={handleInputClick}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            className="flex-1 h-8 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-2"
          />
          <Button
            onClick={handleSend}
            disabled={(!input.trim() && imagePreviewUrls.length === 0) || isLoading || uploadingImages}
            size="icon"
            className="h-8 w-8 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        
        {helpText && (
          <p className="text-xs text-muted-foreground mt-2">
            {helpText}
          </p>
        )}
      </div>
    </div>
  );
}

