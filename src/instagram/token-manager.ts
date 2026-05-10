import { prisma } from "../db/db";
import { ERROR_MESSAGES } from "../config/instagram.config";
import { fetchFromInstagram } from "./gateway";
import { RefreshTokenResponse } from "../types/instagram.types";
import { invalidateUserCacheR } from "../redis/operations/user";
import { logger } from "../logger";
import { encrypt, decrypt } from "../helpers/encryption";
import { InstagramTokenExpiredError } from "../errors/instagram.errors";

export async function refreshAccessToken(
  accountId: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const account = await prisma.instaAccount.findUnique({
    where: { id: accountId },
    include: { user: { select: { clerkId: true } } },
  });
  if (!account) throw new Error(ERROR_MESSAGES.AUTH.NO_INSTAGRAM_ACCOUNT);

  try {
    const params = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: decrypt(account.accessToken),
    });

    const url = `https://graph.instagram.com/refresh_access_token?${params.toString()}`;
    const response = await fetchFromInstagram<RefreshTokenResponse>(url, {
      method: "GET",
      timeoutMs: 15000,
      retries: 2,
      webhookUserId: account.webhookUserId || undefined,
    });

    if (!response.ok) throw response.error;

    const data = response.value;
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await prisma.instaAccount.update({
      where: { id: accountId },
      data: {
        accessToken: encrypt(data.access_token),
        tokenExpiresAt: expiresAt,
        lastSyncedAt: new Date(),
      },
    });

    return { accessToken: data.access_token, expiresAt };
  } catch (error: any) {
    // Only deactivate for confirmed auth revocation or invalid tokens (e.g. code 190)
    // Infrastructure errors (timeouts, 500s) should not deactivate the account
    const errorCode =
      error.code || error.error?.code || error.response?.error?.code;
    const errorSubcode =
      error.error_subcode ||
      error.error?.error_subcode ||
      error.response?.error?.error_subcode;

    const isAuthError =
      error instanceof InstagramTokenExpiredError ||
      errorCode === 190 ||
      errorSubcode === 463 || // Expired
      errorSubcode === 467 || // Invalid
      errorSubcode === 460 || // Password changed
      error.message?.toLowerCase().includes("oauth") ||
      error.message?.toLowerCase().includes("invalid token") ||
      error.message?.toLowerCase().includes("revoked");

    if (isAuthError) {
      logger.warn(
        {
          accountId,
          instagramUserId: account.instagramUserId,
          error: error.message,
        },
        "Instagram token revoked or expired — deactivating account.",
      );

      // Best-effort deactivation
      await prisma.instaAccount
        .update({
          where: { id: accountId },
          data: { isActive: false },
        })
        .catch((dbErr) => {
          logger.error(
            { accountId, error: dbErr.message },
            "Failed to update isActive=false in DB during revocation handling",
          );
        });

      // Best-effort cache cleanup
      const clerkId = account.user?.clerkId;
      const webhookUserId = account.webhookUserId;

      if (clerkId && webhookUserId) {
        try {
          await invalidateUserCacheR(
            clerkId,
            webhookUserId,
            account.instagramUserId || undefined,
          );
        } catch (cacheError: any) {
          logger.error(
            { accountId, error: cacheError.message },
            "Volatile cache cleanup failed during revocation handling",
          );
        }
      } else {
        logger.warn(
          { accountId, clerkId, webhookUserId },
          "Skipping cache invalidation during revocation: Missing mandatory identifiers.",
        );
      }
    } else {
      // For non-auth errors (timeout, 5xx), we log but keep the account active
      logger.error(
        {
          accountId,
          instagramUserId: account.instagramUserId,
          error: error.message,
        },
        "Instagram token refresh failed (transient error) — account remains active",
      );
    }

    // Always rethrow the original error for the caller to handle
    throw error;
  }
}

export function isTokenExpiringSoon(
  expiresAt: Date,
  daysThreshold: number = 7,
): boolean {
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
  return expiresAt <= thresholdDate;
}

export async function getValidAccessToken(accountId: string): Promise<string> {
  const account = await prisma.instaAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) throw new Error(ERROR_MESSAGES.AUTH.NO_INSTAGRAM_ACCOUNT);

  if (isTokenExpiringSoon(account.tokenExpiresAt)) {
    const { accessToken } = await refreshAccessToken(accountId);
    return accessToken; // refreshAccessToken returns plain token
  }
  return decrypt(account.accessToken);
}
