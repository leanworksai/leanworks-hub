import { ReactNode, useRef, useEffect, useLayoutEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { ChatMessage } from "./ChatMessage";
import { DateSeparator } from "./DateSeparator";
import { Message, ChannelMessage, LikedByUser } from "./types";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { trackLoadMoreMessages, trackScrollDepth } from "@/lib/analytics";

const MESSAGE_LOAD_INCREMENT = 20;
const SCROLL_BOTTOM_THRESHOLD = 10; // Pixels threshold for considering "at bottom"

export interface ChatMessageListProps {
  messages: (Message | ChannelMessage)[];
  visibleCount: number;
  onLoadMore: (increment: number) => void;
  currentUserEmail: string;
  onToggleLike: (messageId: string, currentLikes: string[]) => void;
  getLikedByUsers: (likes: string[]) => LikedByUser[];
  getUserDisplayInfo: (message: Message | ChannelMessage) => {
    isSent: boolean;
    isLean: boolean;
    displayName: string;
    displayInitials: string;
  };
  onImageError?: (e: React.SyntheticEvent<HTMLImageElement>, imageUrls: string[], idx: number) => void;
  emptyState?: ReactNode;
  isLoading?: boolean;
  loadingIndicator?: ReactNode;
  className?: string;
  onDraftResponse?: (messageId: string) => void;
  isGeneratingDraft?: boolean;
  generatingDraftMessageId?: string | null;
  hideContext?: boolean;
  theme?: "default" | "ai-chat"; // Theme for styling - only "ai-chat" gets special styling
  getUserDisplayName?: (email: string) => string | null; // Function to get user display name from email
}

export interface ChatMessageListRef {
  scrollToBottom: () => void;
}

export const ChatMessageList = forwardRef<ChatMessageListRef, ChatMessageListProps>(({
  messages,
  visibleCount,
  onLoadMore,
  currentUserEmail,
  onToggleLike,
  getLikedByUsers,
  getUserDisplayInfo,
  onImageError,
  emptyState,
  isLoading,
  getUserDisplayName,
  loadingIndicator,
  className,
  onDraftResponse,
  isGeneratingDraft = false,
  generatingDraftMessageId = null,
  hideContext = false,
  theme = "default",
}, ref) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const previousMessagesLengthRef = useRef(0);
  const isUserNearBottomRef = useRef(true);
  const hasScrolledOnInitialLoadRef = useRef(false);
  const userHasManuallyScrolledRef = useRef(false);
  const scrollableElementRef = useRef<HTMLElement | null>(null);
  const userTimezone = useUserTimezone();

  /**
   * Checks if the scroll container is at the bottom
   * @param container - The scroll container element
   * @returns True if at bottom (within threshold)
   */
  const isAtBottom = (container: HTMLElement): boolean => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    const maxScroll = scrollHeight - clientHeight;
    return Math.abs(scrollTop - maxScroll) < SCROLL_BOTTOM_THRESHOLD;
  };

  /**
   * Find the actual scrollable element (handles ScrollArea from Radix UI)
   * Caches the result to avoid repeated DOM queries
   */
  const getScrollableElement = (): HTMLElement | null => {
    // Return cached value if available and element still exists
    if (scrollableElementRef.current && document.contains(scrollableElementRef.current)) {
      return scrollableElementRef.current;
    }
    
    const container = scrollContainerRef.current;
    if (!container) return null;
    
    // Check if we're inside a Radix ScrollArea - find the viewport
    const scrollAreaViewport = container.closest('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (scrollAreaViewport) {
      scrollableElementRef.current = scrollAreaViewport;
      if (process.env.NODE_ENV === 'development') {
        console.log('📦 [ChatMessageList] Found ScrollArea viewport');
      }
      return scrollAreaViewport;
    }
    
    // Otherwise, use the container itself if it's scrollable
    if (container.scrollHeight > container.clientHeight) {
      scrollableElementRef.current = container;
      return container;
    }
    
    // Try to find a scrollable parent
    let parent = container.parentElement;
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight && 
          (parent.style.overflow === 'auto' || 
           parent.style.overflowY === 'auto' || 
           getComputedStyle(parent).overflowY === 'auto')) {
        scrollableElementRef.current = parent;
        if (process.env.NODE_ENV === 'development') {
          console.log('📦 [ChatMessageList] Found scrollable parent');
        }
        return parent;
      }
      parent = parent.parentElement;
    }
    
    scrollableElementRef.current = container;
    return container;
  };

  /**
   * Fast, simple scroll-to-bottom following industry best practices (Slack/Discord pattern)
   * @param instant - If true, scrolls instantly without animation
   */
  const scrollToBottom = (instant = false): void => {
    const scrollable = getScrollableElement();
    if (!scrollable) return;
    
    try {
      // Direct scroll assignment - fastest method (industry standard)
      const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      if (process.env.NODE_ENV === 'development') {
        console.log('📜 [ChatMessageList] scrollToBottom', {
          scrollHeight: scrollable.scrollHeight,
          clientHeight: scrollable.clientHeight,
          maxScroll,
          currentScrollTop: scrollable.scrollTop,
        });
      }
      
      if (maxScroll > 0) {
        if (instant) {
          // Synchronous scroll for instant
          scrollable.scrollTop = maxScroll;
        } else {
          // Smooth scroll
          scrollable.scrollTo({ top: maxScroll, behavior: 'smooth' });
        }
        if (process.env.NODE_ENV === 'development') {
          console.log('✅ [ChatMessageList] scrollToBottom completed', {
            finalScrollTop: scrollable.scrollTop,
          });
        }
      } else if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ [ChatMessageList] scrollToBottom: maxScroll <= 0', {
          scrollHeight: scrollable.scrollHeight,
          clientHeight: scrollable.clientHeight,
        });
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error scrolling to bottom:', error);
      }
    }
  };

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => scrollToBottom(false),
  }));

  // Clear scrollable element cache when messages change significantly
  useEffect(() => {
    // Clear cache when component unmounts or messages change significantly
    return () => {
      scrollableElementRef.current = null;
    };
  }, [messages.length]);

  // Setup scroll listener for smart auto-scroll detection
  useEffect(() => {
    const setupScrollListener = (scrollable: HTMLElement) => {
      // Track scroll depth milestones
      const trackedDepths = new Set<number>();
      
      // Track if user is near bottom (within 100px threshold) and manual scrolling
      const handleScroll = () => {
        try {
          const { scrollTop, scrollHeight, clientHeight } = scrollable;
          const threshold = 100;
          const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
          isUserNearBottomRef.current = isNearBottom;
          
          // Track scroll depth milestones (25%, 50%, 75%, 100%)
          if (scrollHeight > 0) {
            const scrollPercent = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100);
            const milestones = [25, 50, 75, 100];
            milestones.forEach(depth => {
              if (scrollPercent >= depth && !trackedDepths.has(depth)) {
                trackedDepths.add(depth);
                const pagePath = window.location.pathname;
                trackScrollDepth(pagePath, depth as 25 | 50 | 75 | 100);
              }
            });
          }
          
          // If user scrolls away from bottom, mark as manually scrolled
          if (!isNearBottom && scrollTop > 100) {
            userHasManuallyScrolledRef.current = true;
          }
          // If user scrolls back to bottom, reset manual scroll flag
          if (isNearBottom && scrollTop > 0) {
            userHasManuallyScrolledRef.current = false;
          }
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Error in scroll handler:', error);
          }
        }
      };
      
      scrollable.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        scrollable.removeEventListener('scroll', handleScroll);
      };
    };
    
    const scrollable = getScrollableElement();
    if (!scrollable) {
      // Retry after a short delay in case ScrollArea hasn't mounted yet
      const timer = setTimeout(() => {
        const retryScrollable = getScrollableElement();
        if (retryScrollable) {
          setupScrollListener(retryScrollable);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    
    return setupScrollListener(scrollable);
  }, [messages.length]); // Re-run when messages change to catch ScrollArea viewport

  // Auto-scroll on new messages (only if user is near bottom or it's initial load)
  useLayoutEffect(() => {
    const previousLength = previousMessagesLengthRef.current;
    const currentLength = messages.length;
    const isInitialLoad = isInitialLoadRef.current;
    const hasNewMessages = currentLength > previousLength;
    const wasEmpty = previousLength === 0;
    
    // DEBUG: Log every time effect runs
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 [ChatMessageList] Scroll effect triggered', {
        previousLength,
        currentLength,
        isInitialLoad,
        hasNewMessages,
        wasEmpty,
        hasScrolled: hasScrolledOnInitialLoadRef.current,
        containerExists: !!scrollContainerRef.current,
        containerScrollHeight: scrollContainerRef.current?.scrollHeight || 0,
        containerClientHeight: scrollContainerRef.current?.clientHeight || 0,
      });
    }
    
    // Reset initial load flag if messages were cleared
    if (currentLength === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log('📭 [ChatMessageList] Messages cleared, resetting flags');
      }
      isInitialLoadRef.current = true;
      previousMessagesLengthRef.current = 0;
      isUserNearBottomRef.current = true;
      hasScrolledOnInitialLoadRef.current = false;
      return;
    }
    
    // Detect cache load: messages jump from 0 to many, or large jump (likely cache load)
    const isCacheLoad = (wasEmpty && currentLength > 0) || 
                        (previousLength > 0 && currentLength > previousLength + 20);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 [ChatMessageList] Cache load detection', {
        isCacheLoad,
        wasEmpty,
        currentLength,
        previousLength,
        jumpSize: currentLength - previousLength,
      });
    }
    
    // If cache load detected, reset scroll flags to force scroll
    if (isCacheLoad) {
      if (process.env.NODE_ENV === 'development') {
        console.log('💾 [ChatMessageList] Cache load detected! Resetting scroll flags');
      }
      hasScrolledOnInitialLoadRef.current = false;
      isInitialLoadRef.current = true;
    }
    
    // On initial load (first time messages appear), scroll instantly without animation
    // OR if component mounted with messages and we haven't scrolled yet
    // OR if cache load detected
    const shouldScroll = ((isInitialLoad || wasEmpty || isCacheLoad) && currentLength > 0) || 
                         (currentLength > 0 && !hasScrolledOnInitialLoadRef.current);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 [ChatMessageList] Should scroll?', {
        shouldScroll,
        condition1: (isInitialLoad || wasEmpty || isCacheLoad) && currentLength > 0,
        condition2: currentLength > 0 && !hasScrolledOnInitialLoadRef.current,
        isInitialLoad,
        wasEmpty,
        isCacheLoad,
        currentLength,
        hasScrolled: hasScrolledOnInitialLoadRef.current,
      });
    }
    
    if (shouldScroll) {
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ [ChatMessageList] Attempting to scroll to bottom');
      }
      isInitialLoadRef.current = false;
      
      // Wait for content to be laid out - use requestAnimationFrame to ensure layout is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Double RAF ensures layout is complete
          const scrollable = getScrollableElement();
          
          if (process.env.NODE_ENV === 'development') {
            console.log('🎯 [ChatMessageList] Inside double RAF', {
              containerExists: !!scrollContainerRef.current,
              scrollableExists: !!scrollable,
              scrollHeight: scrollable?.scrollHeight || 0,
              clientHeight: scrollable?.clientHeight || 0,
              hasScrolled: hasScrolledOnInitialLoadRef.current,
            });
          }
          
          if (!scrollable) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('⚠️ [ChatMessageList] Scrollable element not found, retrying after delay');
            }
            // If scrollable not ready, try again after a delay
            setTimeout(() => {
              const retryScrollable = getScrollableElement();
              if (retryScrollable && !hasScrolledOnInitialLoadRef.current) {
                const maxScroll = retryScrollable.scrollHeight - retryScrollable.clientHeight;
                if (process.env.NODE_ENV === 'development') {
                  console.log('🔄 [ChatMessageList] Retry scroll', {
                    maxScroll,
                    scrollHeight: retryScrollable.scrollHeight,
                    clientHeight: retryScrollable.clientHeight,
                    scrollTop: retryScrollable.scrollTop,
                  });
                }
                if (maxScroll > 0) {
                  retryScrollable.scrollTop = maxScroll;
                  hasScrolledOnInitialLoadRef.current = true;
                  if (process.env.NODE_ENV === 'development') {
                    console.log('✅ [ChatMessageList] Scrolled on retry!', {
                      finalScrollTop: retryScrollable.scrollTop,
                    });
                  }
                }
              }
            }, 100);
            return;
          }
          
          const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
          if (process.env.NODE_ENV === 'development') {
            console.log('📏 [ChatMessageList] Scroll calculation', {
              scrollHeight: scrollable.scrollHeight,
              clientHeight: scrollable.clientHeight,
              maxScroll,
              currentScrollTop: scrollable.scrollTop,
            });
          }
          
          if (maxScroll > 0) {
            scrollable.scrollTop = maxScroll;
            hasScrolledOnInitialLoadRef.current = true;
            if (process.env.NODE_ENV === 'development') {
              console.log('✅ [ChatMessageList] Scrolled to bottom!', {
                scrollTop: scrollable.scrollTop,
                maxScroll,
              });
            }
          } else {
            // Only warn if we have messages and expected to scroll
            // If content fits exactly (few messages), this is normal
            if (messages.length > 5 && process.env.NODE_ENV === 'development') {
              console.warn('⚠️ [ChatMessageList] maxScroll <= 0 but have many messages, starting retry loop', {
                scrollHeight: scrollable.scrollHeight,
                clientHeight: scrollable.clientHeight,
                maxScroll,
                messageCount: messages.length,
              });
            } else if (process.env.NODE_ENV === 'development') {
              // Content fits - this is fine, no need to scroll
              console.log('ℹ️ [ChatMessageList] Content fits in viewport, no scroll needed', {
                messageCount: messages.length,
                scrollHeight: scrollable.scrollHeight,
                clientHeight: scrollable.clientHeight,
              });
            }
            if (messages.length <= 5) {
              hasScrolledOnInitialLoadRef.current = true; // Mark as done
              return; // Exit early, no need to retry
            }
            // If scrollHeight is still 0, content isn't laid out yet - retry with multiple attempts
            let retryAttempt = 0;
            const maxRetries = 10;
            
            const retryScroll = () => {
              retryAttempt++;
              const currentScrollable = getScrollableElement();
              if (!currentScrollable) return;
              
              const currentMaxScroll = currentScrollable.scrollHeight - currentScrollable.clientHeight;
              
              // Only log every 3rd attempt to reduce noise
              if (process.env.NODE_ENV === 'development' && (retryAttempt % 3 === 0 || retryAttempt === 1)) {
                console.log(`🔄 [ChatMessageList] Retry attempt ${retryAttempt}/${maxRetries}`, {
                  scrollHeight: currentScrollable.scrollHeight,
                  clientHeight: currentScrollable.clientHeight,
                  maxScroll: currentMaxScroll,
                  hasScrolled: hasScrolledOnInitialLoadRef.current,
                });
              }
              
              if (retryAttempt > maxRetries || hasScrolledOnInitialLoadRef.current) {
                if (retryAttempt > maxRetries && messages.length > 5 && process.env.NODE_ENV === 'development') {
                  // Only error if we have many messages and still can't scroll
                  console.error('❌ [ChatMessageList] Max retries reached, giving up', {
                    messageCount: messages.length,
                    scrollHeight: currentScrollable.scrollHeight,
                    clientHeight: currentScrollable.clientHeight,
                  });
                } else if (retryAttempt > maxRetries) {
                  // Content fits - this is fine
                  hasScrolledOnInitialLoadRef.current = true;
                }
                return;
              }
              
              setTimeout(() => {
                if (!hasScrolledOnInitialLoadRef.current) {
                  const retryScrollable = getScrollableElement();
                  if (retryScrollable) {
                    const retryMaxScroll = retryScrollable.scrollHeight - retryScrollable.clientHeight;
                    if (retryMaxScroll > 0) {
                      retryScrollable.scrollTop = retryMaxScroll;
                      hasScrolledOnInitialLoadRef.current = true;
                      if (process.env.NODE_ENV === 'development') {
                        console.log('✅ [ChatMessageList] Scrolled on retry!', {
                          attempt: retryAttempt,
                          scrollTop: retryScrollable.scrollTop,
                          maxScroll: retryMaxScroll,
                        });
                      }
                    } else if (messages.length <= 5) {
                      // Content fits - mark as done
                      hasScrolledOnInitialLoadRef.current = true;
                    } else {
                      retryScroll(); // Retry again only if we have many messages
                    }
                  }
                }
              }, 50 * retryAttempt); // Exponential backoff
            };
            
            retryScroll();
          }
        });
      });
    } 
    // For new messages after initial load, only auto-scroll if user is near bottom
    else if (hasNewMessages && !isInitialLoad && isUserNearBottomRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.log('📨 [ChatMessageList] New messages, auto-scrolling (user near bottom)');
      }
      // Use setTimeout for smooth scroll (not instant)
      const timer = setTimeout(() => {
        scrollToBottom(false);
      }, 100);
      return () => clearTimeout(timer);
    } else if (process.env.NODE_ENV === 'development') {
      console.log('⏭️ [ChatMessageList] Skipping scroll', {
        hasNewMessages,
        isInitialLoad,
        isUserNearBottom: isUserNearBottomRef.current,
      });
    }
    
    previousMessagesLengthRef.current = currentLength;
  }, [messages.length]); // Only depend on length to reduce unnecessary re-runs

  const totalMessages = messages.length;
  const visibleMessages = messages.slice(-visibleCount);
  const hasMoreMessages = totalMessages > visibleCount;

  /**
   * Handles loading more messages while preserving scroll position
   */
  const handleLoadMore = () => {
    const container = scrollContainerRef.current;
    const increment = Math.min(MESSAGE_LOAD_INCREMENT, totalMessages - visibleCount);
    
    // Track load more action (use window location as chat identifier)
    const chatId = window.location.pathname.includes('/chats/') 
      ? window.location.pathname.split('/chats/')[1]?.split('/')[0] || 'unknown'
      : 'ai-chat';
    trackLoadMoreMessages(chatId, increment, visibleCount + increment);
    
    if (!container) {
      // If container not available, just load more without preserving position
      onLoadMore(increment);
      return;
    }
    
    try {
      // Store current scroll position before loading
      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;
      
      // Load more messages
      onLoadMore(increment);
      
      // Restore scroll position after new messages render
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          // Calculate new scroll position to maintain visual position
          container.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
        }
      });
    } catch (error) {
      // If scroll preservation fails, still load messages
      onLoadMore(increment);
      if (process.env.NODE_ENV === 'development') {
        console.error('Error preserving scroll position:', error);
      }
    }
  };

  // Helper function to get date string for a message (in user's timezone)
  const getMessageDateString = (message: Message | ChannelMessage): string => {
    let timestamp: Date;
    if (message.timestamp instanceof Date) {
      timestamp = isNaN(message.timestamp.getTime()) ? new Date() : message.timestamp;
    } else {
      const parsed = new Date(message.timestamp);
      timestamp = isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    // Get date string in user's timezone
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(timestamp);

    return dateStr;
  };

  // Messages with date separators
  const messagesWithSeparators = useMemo(() => {
    if (visibleMessages.length === 0) {
      return [];
    }

    const result: ReactNode[] = [];
    let lastDate: string | null = null;

    visibleMessages.forEach((message, index) => {
      const messageDate = getMessageDateString(message);
      let timestamp: Date;
      if (message.timestamp instanceof Date) {
        timestamp = isNaN(message.timestamp.getTime()) ? new Date() : message.timestamp;
      } else {
        const parsed = new Date(message.timestamp);
        timestamp = isNaN(parsed.getTime()) ? new Date() : parsed;
      }
      
      // Add date separator before first message or when date changed
      if (index === 0 || (lastDate !== null && lastDate !== messageDate)) {
        result.push(
          <DateSeparator 
            key={`date-separator-${message.id}-${index}`}
            date={timestamp}
            timezone={userTimezone}
          />
        );
      }
      
      // Add the message
      const { isSent, isLean, displayName, displayInitials } = getUserDisplayInfo(message);
      result.push(
        <ChatMessage
          key={message.id}
          message={message}
          isSent={isSent}
          isLean={isLean}
          displayName={displayName}
          displayInitials={displayInitials}
          currentUserEmail={currentUserEmail}
          onToggleLike={onToggleLike}
          getLikedByUsers={getLikedByUsers}
          onImageError={onImageError}
          onDraftResponse={onDraftResponse}
          isGeneratingDraft={isGeneratingDraft && generatingDraftMessageId === message.id}
          hideContext={hideContext}
          theme={theme}
          getUserDisplayName={getUserDisplayName}
        />
      );
      
      lastDate = messageDate;
    });

    return result;
  }, [visibleMessages, userTimezone, getUserDisplayInfo, currentUserEmail, onToggleLike, getLikedByUsers, onImageError, onDraftResponse, isGeneratingDraft, generatingDraftMessageId, hideContext]);

  // Use ResizeObserver to detect when content is laid out and ready to scroll
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length === 0) return;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('👀 [ChatMessageList] ResizeObserver effect triggered', {
        messagesLength: messages.length,
        hasScrolled: hasScrolledOnInitialLoadRef.current,
        containerExists: !!container,
      });
    }
    
    // Use ResizeObserver to detect when content height stabilizes
    const resizeObserver = new ResizeObserver((entries) => {
      if (!hasScrolledOnInitialLoadRef.current && messages.length > 0) {
        const scrollable = getScrollableElement();
        if (!scrollable) return;
        
        const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
        if (process.env.NODE_ENV === 'development') {
          console.log('📐 [ChatMessageList] ResizeObserver callback', {
            scrollHeight: scrollable.scrollHeight,
            clientHeight: scrollable.clientHeight,
            maxScroll,
            hasScrolled: hasScrolledOnInitialLoadRef.current,
          });
        }
        
        if (maxScroll > 0) {
          scrollable.scrollTop = maxScroll;
          hasScrolledOnInitialLoadRef.current = true;
          if (process.env.NODE_ENV === 'development') {
            console.log('✅ [ChatMessageList] Scrolled via ResizeObserver!', {
              scrollTop: scrollable.scrollTop,
            });
          }
          resizeObserver.disconnect();
        }
      }
    });
    
    resizeObserver.observe(container);
    
    // Also observe the scrollable element if it's different
    const scrollable = getScrollableElement();
    if (scrollable && scrollable !== container) {
      resizeObserver.observe(scrollable);
    }
    
    // Also try immediately and with multiple attempts
    let attemptCount = 0;
    const maxAttempts = 5;
    
    const attemptScroll = () => {
      if (hasScrolledOnInitialLoadRef.current || attemptCount >= maxAttempts) {
        if (hasScrolledOnInitialLoadRef.current && process.env.NODE_ENV === 'development') {
          console.log('✅ [ChatMessageList] Already scrolled, disconnecting ResizeObserver');
        }
        if (hasScrolledOnInitialLoadRef.current) {
          resizeObserver.disconnect();
        }
        return;
      }
      
      attemptCount++;
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔄 [ChatMessageList] ResizeObserver attempt ${attemptCount}/${maxAttempts}`);
      }
      
      requestAnimationFrame(() => {
        if (!hasScrolledOnInitialLoadRef.current) {
          const scrollable = getScrollableElement();
          if (scrollable) {
            const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
            if (maxScroll > 0) {
              scrollable.scrollTop = maxScroll;
              hasScrolledOnInitialLoadRef.current = true;
              if (process.env.NODE_ENV === 'development') {
                console.log('✅ [ChatMessageList] Scrolled via ResizeObserver attempt!', {
                  attempt: attemptCount,
                  scrollTop: scrollable.scrollTop,
                });
              }
              resizeObserver.disconnect();
            } else {
              // Retry after delay
              setTimeout(() => attemptScroll(), 100 * attemptCount);
            }
          }
        }
      });
    };
    
    attemptScroll();
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [messages.length, messagesWithSeparators.length, messages]); // Add messages to catch cache loads

  if (messages.length === 0 && emptyState) {
    return (
      <div 
        ref={scrollContainerRef}
        className={`${className} flex-1 overflow-y-auto`}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        aria-atomic="false"
      >
        <div className="p-4 space-y-4 min-h-0 flex-1">
          {emptyState}
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={scrollContainerRef} 
      className={`${className} flex-1 overflow-y-auto`}
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
      aria-atomic="false"
    >
        <div className="p-4 space-y-4 min-h-0 flex-1">
          {/* Load more button */}
          {hasMoreMessages && (
            <div className="flex justify-center py-2">
              <button
                onClick={handleLoadMore}
                aria-label={`Load ${Math.min(MESSAGE_LOAD_INCREMENT, totalMessages - visibleCount)} older messages`}
                className="text-sm text-muted-foreground hover:text-foreground px-4 py-2 rounded-md hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                Load {Math.min(MESSAGE_LOAD_INCREMENT, totalMessages - visibleCount)} older messages
              </button>
            </div>
          )}

          {/* Messages with date separators */}
          {messagesWithSeparators}

          {/* Loading indicator */}
          {isLoading && loadingIndicator}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>
  );
});

ChatMessageList.displayName = "ChatMessageList";

