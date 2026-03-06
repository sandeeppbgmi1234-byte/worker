/**
 * Instagram Webhook Event Handler
 * Processes incoming webhook events from Instagram
 */

import {
  findMatchingAutomations,
  // isCommentProcessed,
} from "../../automation/matcher";
import { executeAutomation } from "../../automation/executor";
// import { getValidAccessToken } from "../token-manager";
import {
  validateWebhookPayload,
  validateCommentEvent,
  validateStoryReplyEvent,
} from "./validators/payload";
import { logger } from "../../utils/pino";
import { QUICK_REPLIES } from "../../../config/instagram.config";
import {
  isUserConnected,
  isCommentProcessed,
  isUserOnCooldown,
  getAccessToken,
} from "../../redis";

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
    "[Webhook Entry] Received payload from Meta",
  );

  // Process each entry
  for (const entry of entries) {
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === "comments") {
          logger.info(
            { webhookId, field: change.field },
            "[Webhook Event] Routing to handleCommentEvent",
          );
          await handleCommentEvent(entry.id, change.value, entry.time);
        } else {
          logger.warn(
            { webhookId, field: change.field },
            "[Webhook Event] Ignored unknown change field",
          );
        }
      }
    }

    if (entry.messaging) {
      for (const messagingEvent of entry.messaging) {
        // 1. Story Replies
        if (messagingEvent.message?.reply_to?.story) {
          logger.info(
            { webhookId, senderId: messagingEvent.sender.id },
            "[Webhook Event] Routing to handleStoryReplyEvent",
          );
          await handleStoryReplyEvent(entry.id, messagingEvent);
        }

        // 2. Quick Reply Button Taps
        const qrPayload = (messagingEvent.message as any)?.quick_reply?.payload;
        if (qrPayload?.startsWith(QUICK_REPLIES.BYPASS.PAYLOAD_PREFIX)) {
          logger.info(
            {
              webhookId,
              senderId: messagingEvent.sender.id,
              payload: qrPayload,
            },
            "[Webhook Event] Routing to handleQuickReplyEvent",
          );
          await handleQuickReplyEvent(entry.id, messagingEvent, qrPayload);
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

  // Fast fail via Redis User Connection Check (Fallback to DB)
  const isConnected = await isUserConnected(instagramUserId, async () => {
    const { findInstaAccountByInstagramUserId } =
      await import("../../../server/repositories/insta-account.repository");
    logger.info(
      { instagramUserId },
      "[DB Fetch] Fetching InstaAccount for Connection Check",
    );
    const account = await findInstaAccountByInstagramUserId(instagramUserId);
    return account ? account.isActive : false;
  });

  if (!isConnected) {
    logger.info(
      { instagramUserId },
      "[StoryReply] User not connected. Aborting.",
    );
    return;
  }

  logger.info(
    { instagramUserId },
    "[StoryReply] User connected. Fetching DB Account.",
  );

  // Since we know the account is active, fetch DB account fields conditionally here
  const { findInstaAccountByInstagramUserId } =
    await import("../../../server/repositories/insta-account.repository");
  logger.info({ instagramUserId }, "[DB Fetch] Fetching internal DB Account");
  const dbAccount = await findInstaAccountByInstagramUserId(instagramUserId);
  if (!dbAccount) return;

  // Fetch Automations
  const { findActiveAutomationsByStory } =
    await import("../../../server/repositories/automation.repository");
  logger.info(
    { userId: dbAccount.userId, storyId: event.storyId },
    "[DB Fetch] Fetching Automations for Story",
  );
  const automations = await findActiveAutomationsByStory(
    dbAccount.userId,
    event.storyId,
  );
  if (automations.length === 0) {
    logger.info(
      { instagramUserId, storyId: event.storyId },
      "[StoryReply] No automations found for story. Aborting.",
    );
    return;
  }

  logger.info(
    { instagramUserId, automationCount: automations.length },
    "[StoryReply] Found automations. Matching rules...",
  );

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
  if (matches.length === 0) {
    logger.info(
      { instagramUserId, text: event.text },
      "[StoryReply] No matching rules triggered. Aborting.",
    );
    return;
  }

  logger.info(
    { instagramUserId, matchCount: matches.length },
    "[StoryReply] Rules matched. Fetching Token...",
  );

  // Use Redis to get Access Token
  const accessToken = await getAccessToken(dbAccount.id, async () => {
    const { getValidAccessToken } = await import("../token-manager");
    logger.info(
      { accountId: dbAccount.id },
      "[DB Fetch] Fetching Access Token from DB Native Manager",
    );
    return getValidAccessToken(dbAccount.id);
  });

  for (const match of matches) {
    // 1. Atomic Idempotency Check in Redis
    const alreadyProcessed = await isCommentProcessed(
      event.messageId,
      match.automation.id,
    );
    if (alreadyProcessed) {
      logger.info(
        { messageId: event.messageId, automationId: match.automation.id },
        "[StoryReply] Idempotency lock hit. Skipping duplicate.",
      );
      continue;
    }

    // 2. Atomic Cooldown Check in Redis
    const onCooldown = await isUserOnCooldown(
      event.senderId,
      match.automation.id,
    );
    if (onCooldown) {
      logger.info(
        { userId: event.senderId, automationId: match.automation.id },
        "Story reply skipped due to cooldown limit",
      );
      continue;
    }

    await executeAutomation(
      match.automation,
      commentDataForMatcher,
      accessToken,
      instagramUserId,
    );
    logger.info(
      {
        messageId: event.messageId,
        automationId: match.automation.id,
        success: true,
      },
      "[StoryReply] Automation execution completed successfully.",
    );
  }
}

async function handleCommentEvent(
  instagramUserId: string,
  rawCommentData: any,
  fallbackTimestamp: number,
): Promise<void> {
  // Validattion
  const event = validateCommentEvent(rawCommentData, fallbackTimestamp);

  // Fast fail via Redis User Connection Check (Fallback to DB)
  const isConnected = await isUserConnected(instagramUserId, async () => {
    const { findInstaAccountByInstagramUserId } =
      await import("../../../server/repositories/insta-account.repository");
    logger.info(
      { instagramUserId },
      "[DB Fetch] Fetching InstaAccount for Connection Check",
    );
    const account = await findInstaAccountByInstagramUserId(instagramUserId);
    return account ? account.isActive : false;
  });

  if (!isConnected) {
    logger.info(
      { instagramUserId },
      "[CommentReply] User not connected. Aborting.",
    );
    return;
  }

  logger.info(
    { instagramUserId },
    "[CommentReply] User connected. Fetching DB Account.",
  );

  // Retrieve full internal account data
  const { getAccountByInstagramId, getAutomationsByPost } =
    await import("../../redis");

  const dbAccount = await getAccountByInstagramId(instagramUserId, async () => {
    const { findInstaAccountByInstagramUserId } =
      await import("../../../server/repositories/insta-account.repository");
    logger.info(
      { instagramUserId },
      "[DB Fetch] Fetching internal DB Account natively",
    );
    return findInstaAccountByInstagramUserId(instagramUserId);
  });
  if (!dbAccount) return;

  // Fetch Automations
  const automations = await getAutomationsByPost(
    dbAccount.userId,
    event.mediaId,
    async () => {
      const { findActiveAutomationsByPost } =
        await import("../../../server/repositories/automation.repository");
      logger.info(
        { userId: dbAccount.userId, mediaId: event.mediaId },
        "[DB Fetch] Fetching Automations for Post natively",
      );
      return findActiveAutomationsByPost(dbAccount.userId, event.mediaId);
    },
  );
  if (automations.length === 0) {
    logger.info(
      { instagramUserId, mediaId: event.mediaId },
      "[CommentReply] No automations found for post. Aborting.",
    );
    return;
  }

  logger.info(
    { instagramUserId, automationCount: automations.length },
    "[CommentReply] Found automations. Matching rules...",
  );

  // Match
  const matches = await findMatchingAutomations(event as any, automations);
  if (matches.length === 0) {
    logger.debug(
      { instagramUserId, text: event.text },
      "[CommentReply] No matching rules triggered. Aborting.",
    );
    return;
  }

  logger.debug(
    { instagramUserId, matchCount: matches.length },
    "[CommentReply] Rules matched. Fetching Token...",
  );

  // Use Redis to get Access Token
  const accessToken = await getAccessToken(dbAccount.id, async () => {
    const { getValidAccessToken } = await import("../token-manager");
    return getValidAccessToken(dbAccount.id);
  });

  // Check idempotency and execute
  for (const match of matches) {
    // 1. Atomic Idempotency Check in Redis
    const alreadyProcessed = await isCommentProcessed(
      event.id,
      match.automation.id,
    );
    if (alreadyProcessed) {
      logger.debug(
        { commentId: event.id, automationId: match.automation.id },
        "[CommentReply] Idempotency lock hit. Skipping duplicate.",
      );
      continue;
    }

    // 2. Atomic Cooldown Check in Redis
    const onCooldown = await isUserOnCooldown(
      event.userId,
      match.automation.id,
    );
    if (onCooldown) {
      logger.info(
        { userId: event.userId, automationId: match.automation.id },
        "Comment reply skipped due to cooldown limit",
      );
      continue;
    }

    await executeAutomation(
      match.automation,
      event as any,
      accessToken,
      instagramUserId,
    );
    logger.info(
      { commentId: event.id, automationId: match.automation.id, success: true },
      "[CommentReply] Automation execution completed successfully.",
    );
  }
}

/**
 * Handles Quick Reply Button Taps
 * Specifically for delivering images after the messaging window has been opened
 */
async function handleQuickReplyEvent(
  instagramUserId: string,
  messagingEvent: any,
  payload: string,
): Promise<void> {
  const automationId = payload.split(QUICK_REPLIES.BYPASS.PAYLOAD_PREFIX)[1];
  const senderId = messagingEvent.sender.id;

  logger.info(
    { automationId, senderId, instagramUserId },
    "[QuickReply] Processing image delivery request via Button Tap",
  );

  // 1. Fetch the Automation
  const { findAutomationById } =
    await import("../../../server/repositories/automation.repository");
  const automation = await findAutomationById(automationId);

  if (!automation || !automation.replyImage) {
    logger.error(
      { automationId },
      "[QuickReply] Automation or Image URL not found for this button tap",
    );
    return;
  }

  // 2. Fetch the internal account to get access token
  const { findInstaAccountByInstagramUserId } =
    await import("../../../server/repositories/insta-account.repository");
  const dbAccount = await findInstaAccountByInstagramUserId(instagramUserId);
  if (!dbAccount) {
    logger.error(
      { instagramUserId },
      "[QuickReply] Internal account not found",
    );
    return;
  }

  const accessToken = await getAccessToken(dbAccount.id, async () => {
    const { getValidAccessToken } = await import("../token-manager");
    return getValidAccessToken(dbAccount.id);
  });

  // 3. Send the image direct
  const { sendDirectMessage: dmFunc } = await import("../messaging-api");

  try {
    await dmFunc({
      recipientId: senderId,
      attachmentUrl: automation.replyImage,
      accessToken,
      instagramUserId,
    });
    logger.info(
      { automationId, senderId },
      "[QuickReply] SUCCESS: Image delivered via button tap",
    );
  } catch (err: any) {
    logger.error(
      { error: err.message, automationId, senderId },
      "[QuickReply] FAILED to deliver image after button tap",
    );
  }
}
