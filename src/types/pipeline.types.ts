import type { Automation } from "@prisma/client";

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
      reply_to?: { story: { id: string } };
      quick_reply?: { payload: string };
    };
  }>;
}

export interface InstagramWebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface ValidatedComment {
  id: string;
  text: string;
  username: string;
  userId: string;
  timestamp: string;
  mediaId: string;
}

export interface ValidatedStoryReply {
  messageId: string;
  text: string;
  senderId: string;
  storyId: string;
  timestamp: string;
}

export interface ExecutionResult {
  success: boolean;
  executionId?: string;
  error?: string;
}

export type RefinedEvent =
  | {
      type: "COMMENT";
      event: ValidatedComment;
      webhookId: string;
      time: number;
      instagramUserId: string;
    }
  | {
      type: "STORY_REPLY";
      event: ValidatedStoryReply;
      webhookId: string;
      time: number;
      instagramUserId: string;
    }
  | {
      type: "QUICK_REPLY";
      event: any;
      payload: string;
      webhookId: string;
      time: number;
      instagramUserId: string;
    };

export interface FilteredEvent {
  event: RefinedEvent;
  accountId: string;
  matchedAutomations: Automation[];
}

export interface EnrichedEvent extends FilteredEvent {
  accessToken: string;
}

export interface GuardedEvent extends EnrichedEvent {
  safeAutomations: any[];
}

export interface ExecutionOutcome {
  automationId: string;
  eventId: string;
  status: "SUCCESS" | "FAILED" | "ASK_TO_FOLLOW_SENT";
  errorMessage?: string;
  sentMessage?: string;
  instagramMessageId?: string | null;
  actionType: string;
  commentData: any;
}
