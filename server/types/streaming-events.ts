/**
 * Streaming event types from the leanworks streaming ask API
 * Based on /api/ask?stream=true endpoint
 */

export type StreamEvent = 
  | ToolStartEvent
  | ToolEndEvent
  | TextDeltaEvent
  | DoneEvent
  | ErrorEvent;

export interface ToolStartEvent {
  type: 'tool_start';
  tool_name: string;
  display_name: string;
  description: string;
}

export interface ToolEndEvent {
  type: 'tool_end';
  tool_name: string;
  summary: string;
}

export interface TextDeltaEvent {
  type: 'text_delta';
  text: string;
}

export interface DoneEvent {
  type: 'done';
  data_sources?: string[];
}

export interface ErrorEvent {
  type: 'error';
  error: string;
}

/**
 * Helper to format SSE message
 */
export function formatSSEMessage(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Helper to parse SSE message
 */
export function parseSSEMessage(line: string): StreamEvent | null {
  if (!line.startsWith('data: ')) {
    return null;
  }
  
  try {
    const json = line.substring(6); // Remove 'data: ' prefix
    return JSON.parse(json) as StreamEvent;
  } catch (error) {
    console.error('Failed to parse SSE message:', error);
    return null;
  }
}
