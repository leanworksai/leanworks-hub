import { z } from 'zod';

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

// Call offer schema
export const callOfferSchema = z.object({
  offer: z.any(), // WebRTC offer (complex object)
  calleeEmail: emailSchema,
});

// Call answer schema
export const callAnswerSchema = z.object({
  callId: z.string().min(1, 'Call ID is required'),
  answer: z.any(), // WebRTC answer (complex object)
});

// ICE candidate schema
export const iceCandidateSchema = z.object({
  callId: z.string().min(1, 'Call ID is required'),
  candidate: z.any(), // ICE candidate (complex object)
});

// End call schema
export const endCallSchema = z.object({
  callId: z.string().min(1, 'Call ID is required'),
});

// Export types
export type CallOfferInput = z.infer<typeof callOfferSchema>;
export type CallAnswerInput = z.infer<typeof callAnswerSchema>;
export type IceCandidateInput = z.infer<typeof iceCandidateSchema>;
export type EndCallInput = z.infer<typeof endCallSchema>;
