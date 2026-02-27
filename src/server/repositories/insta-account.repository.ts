/**
 * Instagram Account Repository
 * Data access layer for InstaAccount model operations
 * Supports Instagram Login (no Facebook Page required)
 */

import { prisma } from "../../db/db";
import { executeWithErrorHandling } from "./repository-utils";

/**
 * Finds an Instagram account by Instagram user ID
 */
export async function findInstaAccountByInstagramUserId(
  instagramUserId: string,
) {
  // Ensures Instagram user ID is a string for consistent querying
  const userIdString = String(instagramUserId);

  // Tries exact match first
  let instaAccount = await prisma.instaAccount.findUnique({
    where: { webhookUserId: userIdString },
    select: {
      id: true,
      userId: true,
      accessToken: true,
      instagramUserId: true,
      webhookUserId: true,
      isActive: true,
      user: {
        select: {
          clerkId: true,
        },
      },
    },
  });

  // If not found, tries fallback
  if (!instaAccount) {
    instaAccount = await prisma.instaAccount.findUnique({
      where: { instagramUserId: userIdString },
      select: {
        id: true,
        userId: true,
        accessToken: true,
        instagramUserId: true,
        webhookUserId: true,
        isActive: true,
        user: {
          select: {
            clerkId: true,
          },
        },
      },
    });
  }

  return instaAccount;
}

/**
 * Finds an Instagram account by user ID
 */
export async function findInstaAccountByUserId(userId: string) {
  return executeWithErrorHandling(
    () =>
      prisma.instaAccount.findUnique({
        where: { userId },
      }),
    {
      operation: "findInstaAccountByUserId",
      model: "InstaAccount",
      fallback: null,
      retries: 1,
    },
  );
}

/**
 * Finds an Instagram account by ID
 */
export async function findInstaAccountById(id: string) {
  return executeWithErrorHandling(
    () =>
      prisma.instaAccount.findUnique({
        where: { id },
      }),
    {
      operation: "findInstaAccountById",
      model: "InstaAccount",
      fallback: null,
      retries: 1,
    },
  );
}

/**
 * Finds an Instagram account by automation ID
 */
export async function findInstaAccountByAutomationId(automationId: string) {
  return executeWithErrorHandling(
    () =>
      prisma.instaAccount.findFirst({
        where: {
          user: {
            automations: {
              some: {
                id: automationId,
              },
            },
          },
        },
      }),
    {
      operation: "findInstaAccountByAutomationId",
      model: "InstaAccount",
      fallback: null,
      retries: 1,
    },
  );
}
