import { useRef, useState, useCallback, KeyboardEvent, ChangeEvent, useEffect } from "react";
import { X, Send, Image as ImageIcon, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, getAvatarColor } from "@/lib/utils";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";
import { CitedContext, TeamMember } from "./types";
import { Project } from "@/data/projectsData";
import { Task } from "@/data/tasksData";
import { Doc } from "@/data/docsData";
import { ContextBadges } from "@/components/ContextBadges";
import { trackEmojiPicker, trackMention } from "@/lib/analytics";

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
  selectedDocs?: Doc[];
  onRemoveProject?: (project: Project) => void;
  onRemoveTask?: (task: Task) => void;
  onRemoveDoc?: (doc: Doc) => void;
  selectedText?: { id: string; text: string; docId?: string } | null;
  onRemoveSelectedText?: () => void;
  
  // Image handling
  imagePreviewUrls?: string[];
  onImageSelect?: (e: ChangeEvent<HTMLInputElement>) => void;
  onImageRemove?: (index: number) => void;
  
  // Placeholder
  placeholder?: string;
  helpText?: string;
  
  // Hide context badges
  hideContext?: boolean;
  
  // Implicit context (current page context)
  implicitContext?: string;
  
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
  selectedDocs = [],
  onRemoveProject,
  onRemoveTask,
  onRemoveDoc,
  selectedText,
  onRemoveSelectedText,
  imagePreviewUrls = [],
  onImageSelect,
  onImageRemove,
  placeholder = "Type your message...",
  helpText,
  hideContext = false,
  implicitContext,
  theme = "default",
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPurpleTheme = theme === "purple";
  
  // Track key hold state to detect accent menu trigger
  const keyHoldTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isKeyHeldRef = useRef(false);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (keyHoldTimeoutRef.current) {
        clearTimeout(keyHoldTimeoutRef.current);
      }
    };
  }, []);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Calculate the new height (min 40px, max ~200px for ~8 lines)
    const scrollHeight = textarea.scrollHeight;
    const minHeight = 40; // ~1 line
    const maxHeight = 200; // ~8 lines at ~25px per line
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
    
    textarea.style.height = `${newHeight}px`;
    
    // Enable scrolling if content exceeds max height
    if (scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }, [input]);

  const handleSend = useCallback(() => {
    if (!input.trim() && imagePreviewUrls.length === 0) return;
    onSend(input.trim(), imagePreviewUrls);
    setInput("");
    // Reset textarea height after sending
    setTimeout(() => {
      const textarea = inputRef.current;
      if (textarea) {
        textarea.style.height = '40px';
      }
    }, 0);
  }, [input, imagePreviewUrls, onSend]);

  const insertMention = useCallback((user: TeamMember) => {
    const beforeMention = input.substring(0, mentionCursorPos);
    const afterCursor = input.substring(inputRef.current?.selectionStart || input.length);
    // Extract first name only (everything before the first space)
    const firstName = user.name.split(' ')[0];
    const newInput = `${beforeMention}@${firstName} ${afterCursor}`;
    setInput(newInput);
    onMentionClose?.();
    
    // Track mention insertion
    trackMention('insert');
    
    // Focus input and move cursor after mention
    setTimeout(() => {
      inputRef.current?.focus();
      const newCursorPos = beforeMention.length + firstName.length + 2; // +2 for @ and space
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [input, mentionCursorPos, onMentionClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isSingleLetter = e.key.length === 1 && /^[a-zA-Z]$/.test(e.key);
    
    // Detect if key is being held down (accent menu trigger on macOS)
    if (isSingleLetter) {
      if (e.repeat) {
        // Key is being held - mark as held and prevent accent menu
        isKeyHeldRef.current = true;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Set a flag after a short delay - if composition starts during this time, it's accent menu
      isKeyHeldRef.current = false;
      if (keyHoldTimeoutRef.current) {
        clearTimeout(keyHoldTimeoutRef.current);
      }
      keyHoldTimeoutRef.current = setTimeout(() => {
        isKeyHeldRef.current = true;
      }, 200); // After 200ms, consider it a hold
    } else {
      // Reset on non-letter keys
      isKeyHeldRef.current = false;
      if (keyHoldTimeoutRef.current) {
        clearTimeout(keyHoldTimeoutRef.current);
      }
    }

    // Handle mention suggestions navigation first
    if (showMentionSuggestions && filteredMentionUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onMentionIndexChange?.((selectedMentionIndex + 1) % filteredMentionUsers.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onMentionIndexChange?.(
          selectedMentionIndex > 0 ? selectedMentionIndex - 1 : filteredMentionUsers.length - 1
        );
        return;
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const selectedUser = filteredMentionUsers[selectedMentionIndex];
        if (selectedUser) {
          insertMention(selectedUser);
          onMentionSelect?.(selectedUser);
        }
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onMentionClose?.();
        return;
      }
    }
    
    // Handle Enter key: Shift+Enter = new line, Enter = send
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Let Shift+Enter pass through naturally for new lines
  }, [handleSend, showMentionSuggestions, filteredMentionUsers, selectedMentionIndex, onMentionIndexChange, onMentionSelect, onMentionClose, insertMention]);

  // Prevent accent character menu by blocking composition events
  const handleCompositionStart = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    // If key is being held or was recently held, this is likely the accent menu
    if (isKeyHeldRef.current) {
      e.preventDefault();
      e.stopPropagation();
      // Clear the flag
      isKeyHeldRef.current = false;
      if (keyHoldTimeoutRef.current) {
        clearTimeout(keyHoldTimeoutRef.current);
      }
      return;
    }
    
    // Also check if composition starts immediately after a single letter (accent menu pattern)
    const textarea = e.currentTarget;
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const lastChar = textBefore.slice(-1);
    
    // If composition starts right after a single letter, it's likely the accent menu
    if (lastChar && lastChar.length === 1 && /^[a-zA-Z]$/.test(lastChar)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }, []);

  const handleCompositionUpdate = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    // Prevent all composition updates if we're blocking accent menu
    if (isKeyHeldRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }, []);

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    // Prevent composition end if we blocked it
    if (isKeyHeldRef.current) {
      e.preventDefault();
      e.stopPropagation();
      isKeyHeldRef.current = false;
      if (keyHoldTimeoutRef.current) {
        clearTimeout(keyHoldTimeoutRef.current);
      }
      return;
    }
  }, []);

  // Handle paste events to support pasting images directly
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];

    // Process all clipboard items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Check if item is an image
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          // Validate file type
          const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
          const isValidType = validTypes.includes(file.type);
          
          if (!isValidType) {
            continue; // Skip invalid image types
          }

          // Validate file size (10MB max)
          if (file.size > 10 * 1024 * 1024) {
            continue; // Skip files that are too large
          }

          imageFiles.push(file);
        }
      }
    }

    // If images were pasted, process them
    if (imageFiles.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for images
      
      // Create a synthetic event that mimics the file input change event
      // This allows us to reuse the existing onImageSelect handler
      if (onImageSelect && fileInputRef.current) {
        // Create a DataTransfer object to simulate file input
        const dataTransfer = new DataTransfer();
        imageFiles.forEach(file => dataTransfer.items.add(file));
        
        // Create a synthetic change event that mimics a real file input change event
        // The handler reads from e.target.files, so we need to ensure that's set correctly
        const syntheticEvent = {
          target: {
            files: dataTransfer.files,
          },
          currentTarget: {
            files: dataTransfer.files,
          },
        } as React.ChangeEvent<HTMLInputElement>;
        
        // Call the existing image select handler
        onImageSelect(syntheticEvent);
        
        // Reset the file input
        fileInputRef.current.value = '';
      }
    }
    // If no images, let the default paste behavior handle text
  }, [onImageSelect]);

  // Handle drag and drop events
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if dragging files
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only set dragging to false if we're leaving the container itself
    // (not just moving between child elements)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Filter and validate image files
    const imageFiles = files.filter(file => {
      // Validate file type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const fileName = file.name.toLowerCase();
      const isValidType = validTypes.includes(file.type) || 
                          validExtensions.some(ext => fileName.endsWith(ext));
      
      if (!isValidType) {
        return false;
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        return false;
      }

      return true;
    });

    if (imageFiles.length > 0 && onImageSelect && fileInputRef.current) {
      // Create a DataTransfer object to simulate file input
      const dataTransfer = new DataTransfer();
      imageFiles.forEach(file => dataTransfer.items.add(file));
      
      // Create a synthetic change event that mimics a real file input change event
      // The handler reads from e.target.files, so we need to ensure that's set correctly
      const syntheticEvent = {
        target: {
          files: dataTransfer.files,
        },
        currentTarget: {
          files: dataTransfer.files,
        },
      } as React.ChangeEvent<HTMLInputElement>;
      
      // Call the existing image select handler
      onImageSelect(syntheticEvent);
      
      // Reset the file input
      fileInputRef.current.value = '';
    }
  }, [onImageSelect]);

  const insertEmoji = useCallback((emojiData: EmojiClickData) => {
    const cursorPos = inputRef.current?.selectionStart || input.length;
    const newValue = input.slice(0, cursorPos) + emojiData.emoji + input.slice(cursorPos);
    setInput(newValue);
    setShowEmojiPicker(false);
    
    // Track emoji selection
    trackEmojiPicker('select', emojiData.emoji);
    
    // Focus and set cursor position after emoji
    setTimeout(() => {
      inputRef.current?.focus();
      const newCursorPos = cursorPos + emojiData.emoji.length;
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [input]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
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
          if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
            setMentionCursorPos(lastAtIndex);
            // Track mention detection
            trackMention('detect');
          }
        }
      }
    }
  }, [showMentions, onMentionDetect]);

  const handleInputClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (showMentions && onMentionDetect) {
      const cursorPos = (e.target as HTMLTextAreaElement).selectionStart || 0;
      onMentionDetect(input, cursorPos);
      // Track mention cursor position
      const textBeforeCursor = input.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      if (lastAtIndex !== -1) {
        const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
        if (charBeforeAt === ' ' || lastAtIndex === 0) {
          const afterAt = textBeforeCursor.substring(lastAtIndex + 1);
          if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
            setMentionCursorPos(lastAtIndex);
          }
        }
      }
    }
  }, [showMentions, onMentionDetect, input]);
  
  return (
    <div className={cn(
      "border-t border-border",
      isPurpleTheme 
        ? "bg-white/70 backdrop-blur-md border-purple-200/60 shadow-lg shadow-purple-100/50 dark:shadow-purple-900/20" 
        : "bg-background"
    )}>
      {!hideContext && (
        <ContextBadges
          projects={selectedProjects}
          tasks={selectedTasks}
          docs={selectedDocs}
          onRemoveProject={onRemoveProject}
          onRemoveTask={onRemoveTask}
          onRemoveDoc={onRemoveDoc}
          variant="inline"
          implicitContext={implicitContext}
          selectedText={selectedText}
          onRemoveSelectedText={onRemoveSelectedText}
        />
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
        
        <div 
          className={cn(
            "flex items-end gap-2 rounded-lg px-2 py-1.5 transition-all bg-background border border-border focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20",
            isDragging && "border-primary ring-2 ring-primary/50 bg-primary/5"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={onImageSelect}
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            multiple
            className="hidden"
          />
          <Popover open={showEmojiPicker} onOpenChange={(open) => {
            setShowEmojiPicker(open);
            trackEmojiPicker(open ? 'open' : 'close');
          }}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isLoading || uploadingImages}
                className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-muted"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 border-0" align="start" side="top">
              <EmojiPicker
                onEmojiClick={insertEmoji}
                autoFocusSearch={false}
                theme={"light" as any}
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
            className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-muted"
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={handleCompositionStart}
            onCompositionUpdate={handleCompositionUpdate}
            onCompositionEnd={handleCompositionEnd}
            onClick={handleInputClick}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            rows={1}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-h-[40px] max-h-[200px] resize-none border-0 bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-2 overflow-y-auto"
            style={{ height: '40px' }}
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

