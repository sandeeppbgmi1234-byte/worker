/**
 * Pure validation logic for incoming Instagram Webhooks
 * Throws structured errors if data is corrupt.
 */

import { WebhookEntry, InstagramWebhookPayload } from "../webhook-handler";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validates the top-level webhook payload shape.
 * Returns the actionable entries or an empty array if it's just a setup ping.
 */
export function validateWebhookPayload(
  payload: InstagramWebhookPayload,
): WebhookEntry[] {
  if (payload.object !== "instagram" && payload.object !== "page") {
    throw new ValidationError(
      `Unsupported webhook object type: ${payload.object}`,
    );
  }

  if (!payload.entry || !Array.isArray(payload.entry)) {
    throw new ValidationError(
      "Malformed payload: Missing or invalid 'entry' array",
    );
  }

  // If it's a Meta setup ping, it will have an empty entry array. We safely ignore it.
  if (payload.entry.length === 0) {
    return [];
  }

  return payload.entry;
}

export interface ValidatedComment {
  id: string;
  text: string;
  username: string;
  userId: string;
  timestamp: string;
  mediaId: string; // Extracted postId
}

/**
 * Validates a standard comment webhook event
 */
export function validateCommentEvent(
  commentData: any,
  fallbackTimestamp?: number,
): ValidatedComment {
  if (!commentData || typeof commentData !== "object") {
    throw new ValidationError("Comment data is missing or invalid");
  }

  const { id, text, from } = commentData;
  const timestamp = commentData.timestamp || fallbackTimestamp;
  const mediaId = commentData.media?.id || commentData.media_id;

  if (!id || !text || !from?.id || !from?.username || !timestamp || !mediaId) {
    throw new ValidationError(
      `Incomplete comment payload: ${JSON.stringify(commentData)}`,
    );
  }

  return {
    id,
    text,
    username: from.username,
    userId: from.id,
    timestamp: String(timestamp),
    mediaId,
  };
}

export interface ValidatedStoryReply {
  messageId: string;
  text: string;
  senderId: string;
  storyId: string;
  timestamp: string;
}

/**
 * Validates a messaging event specifically as a story reply
 */
export function validateStoryReplyEvent(
  messagingEvent: any,
): ValidatedStoryReply {
  const message = messagingEvent?.message;
  if (!message || !message.reply_to?.story) {
    throw new ValidationError("Not a valid story reply event");
  }

  const senderId = messagingEvent.sender?.id;
  const storyId = message.reply_to.story.id;
  const text = message.text;
  const messageId = message.mid;
  const timestamp = messagingEvent.timestamp;

  if (!senderId || !storyId || !text || !messageId) {
    throw new ValidationError(
      `Incomplete story reply payload: ${JSON.stringify(messagingEvent)}`,
    );
  }

  return {
    messageId,
    text,
    senderId,
    storyId,
    timestamp: String(timestamp),
  };
}
