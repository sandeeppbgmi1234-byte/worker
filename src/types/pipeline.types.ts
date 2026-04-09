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
      is_echo?: boolean;
    };
    postback?: {
      title: string;
      payload: string;
      mid?: string;
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

export interface ValidatedDm {
  messageId: string;
  text: string;
  senderId: string;
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
      type: "DM_MESSAGE";
      event: ValidatedDm;
      webhookId: string;
      time: number;
      instagramUserId: string;
    }
  | {
      type: "QUICK_REPLY";
      event: any;
      payload: string;
      originEventId?: string;
      webhookId: string;
      time: number;
      instagramUserId: string;
    };

export interface FilteredEvent {
  event: RefinedEvent;
  accountId: string; // Mongo ID of InstaAccount
  userId: string; // Mongo ID of User
  clerkUserId: string; // Clerk ID (user_...)
  webhookUserId: string; // Instagram Webhook ID (178...)
  instagramUsername: string;
  matchedAutomations: Automation[];
}

export interface EnrichedEvent extends FilteredEvent {
  accessToken: string;
}

export interface GuardedEvent extends EnrichedEvent {
  safeAutomations: Automation[];
}

export interface ExecutionOutcome {
  automationId: string;
  userId: string; // Mongo ID of User
  clerkUserId: string; // Clerk ID (user_...)
  webhookUserId: string; // Instagram Webhook ID (178...)
  eventId: string;

  status:
    | "SUCCESS"
    | "FAILED"
    | "ASK_TO_FOLLOW_SENT"
    | "OPENING_MESSAGE_SENT"
    | "SKIPPED";
  errorMessage?: string;
  retryable?: boolean;
  sentMessage?: string;
  instagramMessageId?: string | null;
  actionType: string;
  commentData: any;
}
