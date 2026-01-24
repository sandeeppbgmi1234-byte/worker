/**
 * Instagram Account Repository
 * Data access layer for InstaAccount model operations
 * Supports Instagram Login (no Facebook Page required)
 */

import { prisma } from "../../db/db";
import { executeWithErrorHandling } from "./repository-utils";
import { getRedisClient } from "../../db/redis";
import { logger } from "../../lib/utils/logger";

export interface CreateInstaAccountData {
  userId: string;
  instagramUserId: string;
  username: string;
  accountType?: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt: Date;
  grantedScopes: string[];
}

export interface UpdateInstaAccountData {
  username?: string;
  accountType?: string;
  accessToken?: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date;
  grantedScopes?: string[];
  facebookPageId?: string | null;
  facebookPageName?: string | null;
  lastSyncedAt?: Date;
  webhooksEnabled?: boolean;
  isActive?: boolean;
}

/**
 * Finds an Instagram account by Instagram user ID
 */
export async function findInstaAccountByInstagramUserId(
  instagramUserId: string
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

  // If not found, tries to find all accounts and log them for debugging
  if (!instaAccount) {
    console.log("Account not found with exact match, checking all accounts...");
    const allAccounts = await prisma.instaAccount.findMany({
      select: {
        id: true,
        instagramUserId: true,
        webhookUserId: true,
        username: true,
        isActive: true,
      },
    });
    console.log("All stored Instagram accounts:", allAccounts);
    console.log("Looking for:", userIdString);
    console.log(
      "Type comparison:",
      allAccounts.map((acc) => ({
        stored: acc.webhookUserId,
        storedType: typeof acc.instagramUserId,
        matches: acc.instagramUserId === userIdString,
      }))
    );
  }

  console.log("instaAccount in repository", instaAccount);
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
    }
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
    }
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
    }
  );
}

/**
 * Creates or updates an Instagram account (upsert)
 */
export async function upsertInstaAccount(
  userId: string,
  data: CreateInstaAccountData
) {
  return executeWithErrorHandling(
    () =>
      prisma.instaAccount.upsert({
        where: { userId },
        update: {
          instagramUserId: data.instagramUserId,
          username: data.username,
          accountType: data.accountType,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiresAt: data.tokenExpiresAt,
          grantedScopes: data.grantedScopes,
          lastSyncedAt: new Date(),
          isActive: true,
        },
        create: {
          userId: data.userId,
          instagramUserId: data.instagramUserId,
          username: data.username,
          accountType: data.accountType,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiresAt: data.tokenExpiresAt,
          grantedScopes: data.grantedScopes,
          isActive: true,
        },
      }),
    {
      operation: "upsertInstaAccount",
      model: "InstaAccount",
      retries: 1,
    }
  );
}

/**
 * Updates an Instagram account
 */
export async function updateInstaAccount(
  id: string,
  data: UpdateInstaAccountData
) {
  return executeWithErrorHandling(
    () =>
      prisma.instaAccount.update({
        where: { id },
        data,
      }),
    {
      operation: "updateInstaAccount",
      model: "InstaAccount",
      retries: 1,
    }
  );
}

/**
 * Updates last synced timestamp
 */
export async function updateLastSyncedAt(id: string) {
  return executeWithErrorHandling(
    () =>
      prisma.instaAccount.update({
        where: { id },
        data: { lastSyncedAt: new Date() },
      }),
    {
      operation: "updateLastSyncedAt",
      model: "InstaAccount",
      fallback: null, // Non-critical operation
      retries: 1,
    }
  );
}

/**
 * Deletes an Instagram account
 * @param id - The insta account ID of the Instagram account
 * @param clerkId - The Clerk ID of the user
 * @returns The deleted Instagram account
 */
export async function deleteInstaAccount(instaAccountId: string, clerkId: string) {
  // Gets account info before deletion to clear cache
  const account = await findInstaAccountById(instaAccountId);

  // Clears all cache related to this account
  if (account) {
    const { clearAllUserCache } = await import("../../lib/utils/automation-cache");
    // Uses webhookUserId for cache key (matches webhook handler)
    const webhookUserId = account.webhookUserId || account.instagramUserId || "";
    if (webhookUserId) {
      await clearAllUserCache(webhookUserId, clerkId).catch((error) => {
        // Logs error but doesn't fail the operation
        logger.error(
          "Failed to clear user cache on disconnect",
          error instanceof Error ? error : new Error(String(error)),
          { accountId: instaAccountId, clerkId, webhookUserId }
        );
      });
    }
  }

  return executeWithErrorHandling(
    () =>
      prisma.instaAccount.delete({
        where: { id: instaAccountId }, // Deletes the Instagram account record
      }),
    {
      operation: "deleteInstaAccount",
      model: "InstaAccount",
      retries: 1,
    }
  );
}
