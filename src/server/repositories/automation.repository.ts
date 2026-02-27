/**
 * Automation Repository
 * Data access layer for Automation model operations
 */

import { prisma } from "../../db/db";
import { executeWithErrorHandling } from "./repository-utils";

/**
 * Finds an automation by ID
 */
export async function findAutomationById(automationId: string) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findUnique({
        where: { id: automationId },
      }),
    {
      operation: "findAutomationById",
      model: "Automation",
      fallback: null, // Returns null if not found or on error
      retries: 1,
    },
  );
}

/**
 * Finds active automations for a specific post
 * Fixes schema mismatch by querying the embedded PostTarget
 */
export async function findActiveAutomationsByPost(
  userId: string,
  postId: string,
) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findMany({
        where: {
          userId,
          post: {
            is: {
              id: postId,
            },
          },
          status: "ACTIVE",
        },
      }),
    {
      operation: "findActiveAutomationsByPost",
      model: "Automation",
      fallback: [], // Returns empty array on error (allows webhook to continue)
      retries: 1,
    },
  );
}

/**
 * Finds active automations for a specific story
 * Uses the embedded StoryTarget schema
 */
export async function findActiveAutomationsByStory(
  userId: string,
  storyId: string,
) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findMany({
        where: {
          userId,
          story: {
            is: {
              id: storyId,
            },
          },
          status: "ACTIVE",
        },
      }),
    {
      operation: "findActiveAutomationsByStory",
      model: "Automation",
      fallback: [], // Returns empty array on error (allows webhook to continue)
      retries: 1,
    },
  );
}
