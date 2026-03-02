/**
 * Instagram Webhook Event Handler
 * Processes incoming webhook events from Instagram
 */

import {
  findMatchingAutomations,
  isCommentProcessed,
} from "../../automation/matcher";
import { executeAutomation } from "../../automation/executor";
import { getValidAccessToken } from "../token-manager";
import { logger } from "../../utils/pino";
import {
  validateWebhookPayload,
  validateCommentEvent,
  validateStoryReplyEvent,
} from "./validators/payload";

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
    };
  }>;
}

export interface InstagramWebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

/**
 * Processes a webhook event (Declarative Flow)
 * Errors bubble up to be caught centrally by the worker
 */
export async function processWebhookEvent(
  rawPayload: InstagramWebhookPayload,
): Promise<void> {
  // Validate the payload shape
  const entries = validateWebhookPayload(rawPayload);
  if (entries.length === 0) return; // Ignore setup pings

  const webhookId = entries[0].id;
  logger.info(
    { object: rawPayload.object, webhookId, entryCount: entries.length },
    "Processing webhook entries",
  );

  // Process each entry
  for (const entry of entries) {
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === "comments") {
          await handleCommentEvent(entry.id, change.value, entry.time);
        } else {
          logger.warn({ field: change.field }, "Unknown webhook field");
        }
      }
    }

    if (entry.messaging) {
      for (const messagingEvent of entry.messaging) {
        if (messagingEvent.message?.reply_to?.story) {
          await handleStoryReplyEvent(entry.id, messagingEvent);
        }
      }
    }
  }
}

async function handleStoryReplyEvent(
  instagramUserId: string,
  rawMessagingEvent: any,
): Promise<void> {
  // Validate
  const event = validateStoryReplyEvent(rawMessagingEvent);

  // Fetch Account
  const { findInstaAccountByInstagramUserId } =
    await import("../../../server/repositories/insta-account.repository");
  const dbAccount = await findInstaAccountByInstagramUserId(instagramUserId);
  if (!dbAccount || !dbAccount.isActive) return;

  // Fetch Automations
  const { findActiveAutomationsByStory } =
    await import("../../../server/repositories/automation.repository");
  const automations = await findActiveAutomationsByStory(
    dbAccount.userId,
    event.storyId,
  );
  if (automations.length === 0) return;

  // Match
  // Map to CommentData format to reuse the matching logic natively
  const commentDataForMatcher = {
    id: event.messageId,
    text: event.text,
    username: "user",
    userId: event.senderId,
    timestamp: event.timestamp,
  };
  const matches = await findMatchingAutomations(
    commentDataForMatcher,
    automations,
  );
  if (matches.length === 0) return;

  // Check idempotency and execute
  const accessToken = await getValidAccessToken(dbAccount.id);

  for (const match of matches) {
    const isProcessed = await isCommentProcessed(
      event.messageId,
      match.automation.id,
    );
    if (isProcessed) {
      logger.debug(
        { messageId: event.messageId, automationId: match.automation.id },
        "Story reply already processed",
      );
      continue;
    }

    // TODO: FIXME (User-Level Idempotency)
    // Add check here: Has this user (event.senderId) already triggered this specific automation (match.automation.id)?
    // If yes, silently skip execution to prevent trigger spamming.

    await executeAutomation(
      match.automation.id,
      commentDataForMatcher,
      accessToken,
    );
    logger.info(
      { messageId: event.messageId, automationId: match.automation.id },
      "Story reply automation executed",
    );
  }
}

async function handleCommentEvent(
  instagramUserId: string,
  rawCommentData: any,
  fallbackTimestamp: number,
): Promise<void> {
  // Validate
  const event = validateCommentEvent(rawCommentData, fallbackTimestamp);

  // Fetch Account
  const { findInstaAccountByInstagramUserId } =
    await import("../../../server/repositories/insta-account.repository");
  const dbAccount = await findInstaAccountByInstagramUserId(instagramUserId);
  if (!dbAccount || !dbAccount.isActive) return;

  // Fetch Automations
  const { findActiveAutomationsByPost } =
    await import("../../../server/repositories/automation.repository");
  const automations = await findActiveAutomationsByPost(
    dbAccount.userId,
    event.mediaId,
  );
  if (automations.length === 0) return;

  // Match
  const matches = await findMatchingAutomations(event as any, automations);
  if (matches.length === 0) return;

  // Check idempotency and execute
  for (const match of matches) {
    const isProcessed = await isCommentProcessed(event.id, match.automation.id);
    if (isProcessed) {
      logger.debug(
        { commentId: event.id, automationId: match.automation.id },
        "Comment already processed",
      );
      continue;
    }

    // TODO: FIXME (User-Level Idempotency)
    // Add check here: Has this user (event.userId) already triggered this specific automation (match.automation.id)?
    // If yes, silently skip execution to prevent trigger spamming.

    await executeAutomation(
      match.automation.id,
      event as any,
      dbAccount.accessToken,
    );
    logger.info(
      { commentId: event.id, automationId: match.automation.id },
      "Post comment automation executed",
    );
  }
}
