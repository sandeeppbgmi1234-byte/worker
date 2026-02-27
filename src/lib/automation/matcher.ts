/**
 * Automation Matcher
 * Matches comments against automation triggers
 */

import {
  sanitizeCommentText,
  sanitizeUsername,
  sanitizeText,
} from "../utils/sanitize";
import { safeRegexMatch } from "../utils/safe-regex";
import { Automation } from "@prisma/client";

export interface CommentData {
  id: string;
  text: string;
  username: string;
  userId: string;
  timestamp: string;
}

export interface AutomationRule {
  id: string;
  triggers: string[];
  matchType: "CONTAINS" | "EXACT" | "REGEX";
  actionType: string;
  replyMessage: string;
  useVariables: boolean;
}

export interface MatchResult {
  matched: boolean;
  automation: Automation;
  matchedTrigger?: string;
}

/**
 * Checks if a comment matches an automation's triggers
 * Uses safe regex execution to prevent ReDoS attacks
 */
export async function matchComment(
  comment: CommentData,
  automation: Automation,
): Promise<MatchResult> {
  const commentText = comment.text.toLowerCase().trim();

  for (const trigger of automation.triggers) {
    const triggerLower = trigger.toLowerCase().trim();
    let isMatch = false;

    switch (automation.matchType) {
      case "CONTAINS":
        isMatch = commentText.includes(triggerLower);
        break;

      case "EXACT":
        isMatch = commentText === triggerLower;
        break;

      case "REGEX":
        // Uses safe regex execution with timeout and validation
        isMatch = await safeRegexMatch(trigger, comment.text, "i");
        break;

      default:
        isMatch = commentText.includes(triggerLower);
    }

    if (isMatch) {
      return {
        matched: true,
        automation,
        matchedTrigger: trigger,
      };
    }
  }

  return {
    matched: false,
    automation,
  };
}

/**
 * Finds all automations that match a comment
 * Uses safe regex execution to prevent ReDoS attacks
 */
export async function findMatchingAutomations(
  comment: CommentData,
  automations: Automation[],
): Promise<MatchResult[]> {
  const matchPromises = automations.map((automation) =>
    matchComment(comment, automation),
  );
  const results = await Promise.all(matchPromises);
  return results.filter((result) => result.matched);
}

/**
 * Checks if a comment was already processed by an automation
 * Direct DB check (no cache layer)
 */
export async function isCommentProcessed(
  commentId: string,
  automationId: string,
): Promise<boolean> {
  const { isCommentProcessed: checkProcessed } =
    await import("../../server/repositories/automation-execution.repository");

  return checkProcessed(commentId, automationId);
}

/**
 * Replaces variables in the reply message
 * Sanitizes all user-generated content before insertion to prevent XSS
 */
export function replaceVariables(
  message: string,
  comment: CommentData,
): string {
  // Sanitizes comment data before variable replacement
  const sanitizedUsername = sanitizeUsername(comment.username);
  const sanitizedCommentText = sanitizeCommentText(comment.text);
  const sanitizedCommentId = sanitizeText(comment.id, 100); // Comment IDs are typically short

  // Replaces variables with sanitized values
  return message
    .replace(/{username}/g, sanitizedUsername)
    .replace(/{comment_text}/g, sanitizedCommentText)
    .replace(/{comment_id}/g, sanitizedCommentId);
}

/**
 * Validates and sanitizes comment data from Instagram webhook
 * Ensures all external input is properly sanitized before use
 */
export function validateCommentData(data: any): CommentData | null {
  if (!data.id || !data.text) {
    return null;
  }

  // Sanitizes all comment data from external source (Instagram API)
  return {
    id: sanitizeText(String(data.id), 100), // Comment IDs are typically short
    text: sanitizeCommentText(data.text),
    username: sanitizeUsername(
      data.username || data.from?.username || "unknown",
    ),
    userId: sanitizeText(String(data.from?.id || data.user?.id || ""), 100),
    timestamp: data.timestamp || new Date().toISOString(),
  };
}
