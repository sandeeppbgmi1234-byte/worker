/**
 * Worker Types
 * Type definitions for the worker package
 */

export interface WebhookEntry {
  id: string;
  time: number;
  changes?: Array<{
    field: string;
    value: any;
  }>;
  messaging?: Array<{
    sender: { id: string };
    recipient: { id: string };
    timestamp: number;
    message?: {
      mid: string;
      text: string;
    };
  }>;
}

export interface InstagramWebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface CommentData {
  id: string;
  text: string;
  username: string;
  userId: string;
  timestamp: string;
}

export interface ExecutionResult {
  success: boolean;
  executionId?: string;
  error?: string;
}
