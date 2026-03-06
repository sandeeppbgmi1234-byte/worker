/**
 * Automation Executor
 * State-machine pipeline: Public Reply → Ask to Follow Gate → DM (Image → Text)
 * Each branch is independently guarded so retries never re-execute completed steps.
 */

import { CommentData, replaceVariables } from "./matcher";
import { sendDirectMessage } from "../instagram/messaging-api";
import { replyToComment } from "../instagram/comments-api";
import { checkIfUserFollows } from "../instagram/follower-api";
import {
  checkRateLimits,
  incrementApiUsage,
} from "../instagram/rate-limiting/redis-limiter";
import { logger } from "../utils/pino";
import { Automation } from "@prisma/client";
import { QUICK_REPLIES } from "../../config/instagram.config";

export interface ExecutionResult {
  success: boolean;
  executionId?: string;
  error?: string;
}

// Possible outcomes for the execution status stored in DB
type ExecutionStatus = "SUCCESS" | "FAILED" | "ASK_TO_FOLLOW_SENT";

/**
 * Executes the full automation pipeline for a matched comment.
 * Steps run in order: Public Reply → Follow Check (gate) → DM
 * Any step can exit early without affecting what already ran.
 */
export async function executeAutomation(
  automation: Automation,
  comment: CommentData,
  accessToken: string,
  instagramUserId: string,
): Promise<ExecutionResult> {
  const automationId = automation.id;

  // Prepare DM message with optional variable substitution (e.g., @username)
  let finalMessage = automation.replyMessage;
  if (automation.useVariables) {
    finalMessage = replaceVariables(finalMessage, comment);
  }

  logger.info(
    {
      automationId,
      actionType: automation.actionType,
      triggerType: automation.triggerType,
    },
    "[Executor] Beginning execution pipeline",
  );

  let instagramMessageId: string | null = null;
  let executionStatus: ExecutionStatus = "FAILED";
  let errorMessage: string | null = null;
  // Tracks which steps succeeded to guide safe retries and DB logging
  let sentMessage = finalMessage;

  try {
    // ─── STEP 1: Public Reply ──────────────────────────────────────────────────
    // Runs first, independently of DM. Failure aborts the whole pipeline.
    if (
      automation.actionType === "DM" &&
      automation.commentReplyWhenDm &&
      automation.commentReplyWhenDm.length > 0
    ) {
      await checkRateLimits(instagramUserId);

      // Randomly pick one of the configured public replies
      const pickedReply =
        automation.commentReplyWhenDm[
          Math.floor(Math.random() * automation.commentReplyWhenDm.length)
        ];

      const commentReplyMessage = automation.useVariables
        ? replaceVariables(pickedReply, comment)
        : pickedReply;

      try {
        await replyToComment({
          commentId: comment.id,
          message: commentReplyMessage,
          accessToken,
          instagramUserId,
        });
        logger.info(
          { automationId, commentId: comment.id },
          "[Executor] Step 1: Public reply sent",
        );
      } catch (publicReplyError: any) {
        // Comment may have been deleted — log and abort, don't send DM
        logger.error(
          {
            automationId,
            commentId: comment.id,
            error: publicReplyError.message,
          },
          "[Executor] Step 1: Public reply failed — aborting pipeline",
        );
        throw publicReplyError;
      }
    }

    // ─── STEP 1b: Comment-only flow (COMMENT_REPLY action type) ───────────────
    if (automation.actionType === "COMMENT_REPLY") {
      await checkRateLimits(instagramUserId);

      const result = await replyToComment({
        commentId: comment.id,
        message: finalMessage,
        accessToken,
        instagramUserId,
      });

      instagramMessageId = result.replyId || null;
      executionStatus = "SUCCESS";
      logger.info(
        { automationId, replyId: instagramMessageId },
        "[Executor] COMMENT_REPLY dispatched",
      );

      return await persistExecution({
        automationId,
        comment,
        actionType: automation.actionType,
        sentMessage: finalMessage,
        status: executionStatus,
        instagramMessageId,
        errorMessage: null,
      });
    }

    // ─── STEP 2: Ask to Follow Gate ────────────────────────────────────────────
    // Only evaluated when DM is the action type and the feature is enabled.
    if (automation.askToFollowEnabled) {
      // This call counts as 1 API request — increment the usage counter
      await checkRateLimits(instagramUserId);
      await incrementApiUsage(instagramUserId, 1);

      const { isFollowing } = await checkIfUserFollows(
        instagramUserId,
        comment.userId,
        accessToken,
      );

      if (!isFollowing) {
        // Build the ask-to-follow message — appends profile link if configured
        const askMessage = [
          automation.askToFollowMessage ||
            "Please follow us first and then comment again!",
          automation.askToFollowLink ? `\n${automation.askToFollowLink}` : "",
        ]
          .join("")
          .trim();

        await checkRateLimits(instagramUserId);
        await incrementApiUsage(instagramUserId, 1);

        await sendDirectMessage({
          recipientId: comment.userId,
          commentId:
            automation.triggerType === "STORY_REPLY" ? undefined : comment.id,
          message: askMessage,
          accessToken,
          instagramUserId,
        });

        logger.info(
          { automationId, commenterId: comment.userId },
          "[Executor] Step 2: Ask to Follow message sent — pipeline halted",
        );

        // Job is done. Commenter must follow and comment again to trigger DM.
        executionStatus = "ASK_TO_FOLLOW_SENT";
        sentMessage = askMessage;

        return await persistExecution({
          automationId,
          comment,
          actionType: automation.actionType,
          sentMessage,
          status: "SUCCESS", // Execution was correct, log as success
          instagramMessageId: null,
          errorMessage: null,
          isAskToFollow: true,
        });
      }

      logger.info(
        { automationId, commenterId: comment.userId },
        "[Executor] Step 2: Commenter is following — proceeding to DM",
      );
    }

    // ─── STEP 3: Direct Message Delivery ──────────────────────────────────────
    // Image is sent first, then text (rate limit increments by 1 per call).
    const dmCallCount =
      (automation.replyImage ? 1 : 0) + (automation.replyMessage ? 1 : 0);

    if (dmCallCount > 0) {
      await checkRateLimits(instagramUserId);
      await incrementApiUsage(instagramUserId, dmCallCount);

      // Send image first if configured
      if (automation.replyImage) {
        try {
          const quickReplies =
            automation.triggerType === "STORY_REPLY"
              ? [
                  {
                    title: QUICK_REPLIES.BYPASS.TITLE,
                    payload: `${QUICK_REPLIES.BYPASS.PAYLOAD_PREFIX}${automationId}`,
                  },
                ]
              : undefined;

          await sendDirectMessage({
            recipientId: comment.userId,
            commentId:
              automation.triggerType === "STORY_REPLY" ? undefined : comment.id,
            attachmentUrl: automation.replyImage,
            quickReplies,
            accessToken,
            instagramUserId,
          });
          logger.info({ automationId }, "[Executor] Step 3: Image DM sent");

          // For story cold threads, we stop after the image/button — user taps to get more
          if (automation.triggerType === "STORY_REPLY") {
            executionStatus = "SUCCESS";
            return await persistExecution({
              automationId,
              comment,
              actionType: automation.actionType,
              sentMessage,
              status: executionStatus,
              instagramMessageId: null,
              errorMessage: null,
            });
          }

          // Small breathing gap before the text message
          await new Promise((r) => setTimeout(r, 1000));
        } catch (imgError: any) {
          logger.error(
            { automationId, error: imgError.message },
            "[Executor] Step 3: Image DM failed",
          );
        }
      }

      // Send text message
      if (automation.replyMessage) {
        const quickReplies = automation.replyImage
          ? [
              {
                title: QUICK_REPLIES.BYPASS.TITLE,
                payload: `${QUICK_REPLIES.BYPASS.PAYLOAD_PREFIX}${automationId}`,
              },
            ]
          : undefined;

        const result = await sendDirectMessage({
          recipientId: comment.userId,
          commentId:
            automation.triggerType === "STORY_REPLY" ? undefined : comment.id,
          message: finalMessage,
          quickReplies,
          accessToken,
          instagramUserId,
        });
        instagramMessageId = result.messageId || null;
        logger.info(
          { automationId, messageId: instagramMessageId },
          "[Executor] Step 3: Text DM sent",
        );
      }

      executionStatus = "SUCCESS";
    }
  } catch (error: any) {
    errorMessage = error instanceof Error ? error.message : String(error);
    executionStatus = "FAILED";
    logger.error(
      { automationId, commentId: comment.id, error: errorMessage },
      "[Executor] Pipeline error — recording failure",
    );
  }

  return await persistExecution({
    automationId,
    comment,
    actionType: automation.actionType,
    sentMessage,
    status: executionStatus === "FAILED" ? "FAILED" : "SUCCESS",
    instagramMessageId,
    errorMessage,
  });
}

// ─── Persistence Helper ────────────────────────────────────────────────────────

interface PersistOptions {
  automationId: string;
  comment: CommentData;
  actionType: string;
  sentMessage: string;
  status: "SUCCESS" | "FAILED";
  instagramMessageId: string | null;
  errorMessage: string | null;
  isAskToFollow?: boolean;
}

/**
 * Atomically records execution result in Postgres and increments trigger count on success.
 * On duplicate key (race condition between workers), silently returns success.
 */
async function persistExecution(
  opts: PersistOptions,
): Promise<ExecutionResult> {
  const {
    automationId,
    comment,
    actionType,
    sentMessage,
    status,
    instagramMessageId,
    errorMessage,
  } = opts;

  try {
    const { executeTransaction } =
      await import("../../server/repositories/repository-utils");

    const execution = await executeTransaction(
      async (tx) => {
        const record = await tx.automationExecution.create({
          data: {
            automationId,
            commentId: comment.id,
            commentText: comment.text,
            commentUsername: comment.username,
            commentUserId: comment.userId,
            actionType,
            sentMessage,
            status,
            errorMessage,
            instagramMessageId,
            executedAt: new Date(),
          },
        });

        if (status === "SUCCESS") {
          await tx.automation.update({
            where: { id: automationId },
            data: {
              timesTriggered: { increment: 1 },
              lastTriggeredAt: new Date(),
            },
          });
        }

        logger.info(
          { executionId: record.id, status },
          "[Executor] Execution persisted",
        );
        return record;
      },
      {
        operation: "executeAutomation",
        models: ["AutomationExecution", "Automation"],
      },
    );

    if (status === "FAILED" && errorMessage) {
      throw new Error(errorMessage);
    }

    return { success: true, executionId: execution.id };
  } catch (dbError: any) {
    const { isDuplicateKeyError } =
      await import("../../server/repositories/repository-utils");

    if (isDuplicateKeyError(dbError) || dbError?.code === "P2002") {
      logger.info(
        { automationId, commentId: comment.id },
        "[Executor] Duplicate execution skipped",
      );
      return { success: true };
    }

    throw dbError;
  }
}

/**
 * Batch executes automations for a single comment sequentially.
 */
export async function batchExecuteAutomations(
  automations: Automation[],
  comment: CommentData,
  accessToken: string,
  instagramUserId: string,
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const automation of automations) {
    const result = await executeAutomation(
      automation,
      comment,
      accessToken,
      instagramUserId,
    );
    results.push(result);
  }

  return results;
}
