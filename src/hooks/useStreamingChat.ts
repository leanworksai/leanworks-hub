import { useCallback, useRef, useState } from 'react';

/**
 * Streaming event types matching the leanworks API
 */
export type StreamEvent =
  | { type: 'tool_start'; tool_name: string; display_name: string; description: string }
  | { type: 'bash_command'; command: string }
  | { type: 'tool_end'; tool_name: string; summary: string }
  | { type: 'text_delta'; text: string }
  | { type: 'done'; data_sources?: string[] }
  | { type: 'heartbeat'; timestamp?: number }
  | { type: 'doc_progress'; stage: string; current?: number; total?: number; heading?: string; message: string }
  | { type: 'error'; error: string };

export interface ToolExecution {
  name: string;
  displayName: string;
  description: string;
  summary?: string;
  status: 'running' | 'completed';
  startTime: number;
  endTime?: number;
  /** For bash tool: the command being executed (from bash_command event) */
  command?: string;
}

export interface StreamingState {
  isStreaming: boolean;
  content: string;
  toolExecutions: ToolExecution[];
  dataSources: string[];
  docProgress?: {
    stage: string;
    current?: number;
    total?: number;
    heading?: string;
    message: string;
  };
  error?: string;
}

interface UseStreamingChatOptions {
  onComplete?: (content: string, dataSources: string[]) => void;
  onError?: (error: string) => void;
}

/**
 * Hook to handle streaming chat responses with SSE
 */
export function useStreamingChat(options: UseStreamingChatOptions = {}) {
  const [streamingState, setStreamingState] = useState<StreamingState>({
    isStreaming: false,
    content: '',
    toolExecutions: [],
    dataSources: [],
    docProgress: undefined,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStreaming = useCallback(async (params: {
    chatId: string;
    message: string;
    citedContext?: any;
    orgId?: string;
    orgSlug?: string;
    imageUrls?: string[];
  }) => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Reset state
    setStreamingState({
      isStreaming: true,
      content: '',
      toolExecutions: [],
      dataSources: [],
      docProgress: undefined,
    });

    // Create abort controller for fetch
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Get auth token
      const getAuthToken = async () => {
        const { auth } = await import('@/lib/firebase-client');
        if (auth.currentUser) {
          return await auth.currentUser.getIdToken();
        }
        return null;
      };

      const token = await getAuthToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Make streaming request
      const backendApiBase = import.meta.env.DEV ? 'http://localhost:3001' : '';
      const response = await fetch(`${backendApiBase}/api/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...(params.orgId && { 'x-org-id': params.orgId }),
        },
        body: JSON.stringify({
          chatId: params.chatId,
          message: params.message,
          citedContext: params.citedContext,
          orgId: params.orgId,
          orgSlug: params.orgSlug,
          imageUrls: params.imageUrls,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('✅ Stream complete');
          break;
        }

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) {
            continue;
          }

          try {
            const eventData = line.substring(6); // Remove 'data: ' prefix
            const event = JSON.parse(eventData) as StreamEvent;

            setStreamingState(prev => {
              const newState = { ...prev };

              switch (event.type) {
                case 'tool_start':
                  console.log('🔧 Tool started:', event.tool_name);
                  newState.toolExecutions = [
                    ...prev.toolExecutions,
                    {
                      name: event.tool_name,
                      displayName: event.display_name,
                      description: event.description,
                      status: 'running',
                      startTime: Date.now(),
                    },
                  ];
                  break;

                case 'bash_command': {
                  // Attach command to the most recent running bash tool
                  const lastRunningBashFromEnd = [...prev.toolExecutions]
                    .reverse()
                    .findIndex(tool =>
                      tool.status === 'running' &&
                      (tool.name === 'bash' || tool.displayName.toLowerCase().includes('bash'))
                    );

                  if (lastRunningBashFromEnd !== -1) {
                    const targetIndex = prev.toolExecutions.length - 1 - lastRunningBashFromEnd;
                    newState.toolExecutions = prev.toolExecutions.map((tool, idx) =>
                      idx === targetIndex ? { ...tool, command: event.command } : tool
                    );
                  }
                  break;
                }

                case 'tool_end':
                  console.log('✅ Tool completed:', event.tool_name);
                  newState.toolExecutions = prev.toolExecutions.map(tool =>
                    tool.name === event.tool_name && tool.status === 'running'
                      ? {
                          ...tool,
                          summary: event.summary,
                          status: 'completed',
                          endTime: Date.now(),
                        }
                      : tool
                  );
                  break;

                case 'text_delta':
                  newState.content = prev.content + event.text;
                  break;

                case 'done':
                  console.log('✨ Stream done:', event.data_sources?.length || 0, 'sources');
                  newState.dataSources = event.data_sources || [];
                  newState.isStreaming = false;

                  // Call completion callback
                  if (options.onComplete) {
                    options.onComplete(newState.content, newState.dataSources);
                  }
                  break;

                case 'doc_progress':
                  console.log('📝 Document progress:', event.message);
                  newState.docProgress = {
                    stage: event.stage,
                    current: event.current,
                    total: event.total,
                    heading: event.heading,
                    message: event.message
                  };
                  break;

                case 'heartbeat':
                  // Silent keep-alive - prevents stream timeout
                  // console.log('💓 Heartbeat'); // Enable for debugging
                  break;

                case 'error':
                  console.error('❌ Stream error:', event.error);
                  newState.error = event.error;
                  newState.isStreaming = false;
                  
                  if (options.onError) {
                    options.onError(event.error);
                  }
                  break;
              }

              return newState;
            });
          } catch (error) {
            console.error('Failed to parse SSE event:', error, line);
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Stream aborted by user');
        return;
      }

      console.error('Streaming error:', error);
      setStreamingState(prev => ({
        ...prev,
        isStreaming: false,
        error: error.message,
      }));

      if (options.onError) {
        options.onError(error.message);
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [options]);

  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setStreamingState(prev => ({
      ...prev,
      isStreaming: false,
    }));
  }, []);

  const resetState = useCallback(() => {
    setStreamingState({
      isStreaming: false,
      content: '',
      toolExecutions: [],
      dataSources: [],
      docProgress: undefined,
    });
  }, []);

  return {
    streamingState,
    startStreaming,
    stopStreaming,
    resetState,
  };
}
