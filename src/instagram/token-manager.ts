import { prisma } from "../db/db";
import { ERROR_MESSAGES } from "../config/instagram.config";
import { fetchFromInstagram } from "./gateway";
import { RefreshTokenResponse } from "../types/instagram.types";
import { invalidateUserCacheR } from "../redis/operations/user";
import { logger } from "../logger";
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
      access_token: account.accessToken,
    });

    const url = `https://graph.instagram.com/refresh_access_token?${params.toString()}`;
    const response = await fetchFromInstagram<RefreshTokenResponse>(url, {
      method: "GET",
      timeoutMs: 15000,
      retries: 2,
      instagramUserId: account.instagramUserId,
    });

    if (!response.ok) throw response.error;

    const data = response.value;
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await prisma.instaAccount.update({
      where: { id: accountId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: expiresAt,
        lastSyncedAt: new Date(),
      },
    });

    return { accessToken: data.access_token, expiresAt };
  } catch (error: any) {
    // Only deactivate for confirmed auth revocation or invalid tokens (e.g. code 190)
    // Infrastructure errors (timeouts, 500s) should not deactivate the account
    const isAuthError =
      error instanceof InstagramTokenExpiredError ||
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
      try {
        await invalidateUserCacheR(
          account.user?.clerkId || "",
          account.webhookUserId || "",
        );
      } catch (cacheError: any) {
        logger.error(
          { accountId, error: cacheError.message },
          "Volatile cache cleanup failed during revocation handling",
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
    return accessToken;
  }
  return account.accessToken;
}
