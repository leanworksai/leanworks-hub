import { useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react";
import { X, Send, Image as ImageIcon, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
        onMentionSelect?.(selectedUser);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onMentionClose?.();
    }
  }, [showMentionSuggestions, filteredMentionUsers, selectedMentionIndex, onMentionIndexChange, onMentionSelect, onMentionClose]);

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
    }
  }, [showMentions, onMentionDetect]);

  const handleInputClick = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (showMentions && onMentionDetect) {
      const cursorPos = (e.target as HTMLInputElement).selectionStart || 0;
      onMentionDetect(input, cursorPos);
    }
  }, [showMentions, onMentionDetect, input]);

  return (
    <div className="border-t bg-background">
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
      
      <div className="p-4 relative">
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
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-popover border rounded-md shadow-lg z-50 max-h-60 overflow-auto">
            <div className="p-2">
              <div className="text-xs font-semibold text-muted-foreground px-2 mb-1">Mention</div>
              <div className="space-y-0.5">
                {filteredMentionUsers.map((user, index) => (
                  <div
                    key={user.id}
                    onClick={() => onMentionSelect?.(user)}
                    onMouseEnter={() => onMentionIndexChange?.(index)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
                      index === selectedMentionIndex 
                        ? "bg-primary text-primary-foreground" 
                        : ""
                    )}
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {user.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{user.name}</div>
                      <div className={cn(
                        "text-xs truncate",
                        index === selectedMentionIndex 
                          ? "text-primary-foreground/80" 
                          : "text-muted-foreground"
                      )}>{user.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        
        <div className="flex gap-2 relative">
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
                variant="outline"
                size="icon"
                disabled={isLoading || uploadingImages}
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
            variant="outline"
            size="icon"
            disabled={isLoading || uploadingImages}
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
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={(!input.trim() && imagePreviewUrls.length === 0) || isLoading || uploadingImages}
            size="icon"
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

