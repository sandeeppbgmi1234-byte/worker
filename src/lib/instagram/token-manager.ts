/**
 * Instagram Token Management
 * Handles token refresh and validation using Instagram Graph API
 */

import { prisma } from "../../db/db";
import { ERROR_MESSAGES } from "../../config/instagram.config";

export interface RefreshTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Refreshes an Instagram access token
 * Uses graph.instagram.com/refresh_access_token endpoint
 */
export async function refreshAccessToken(
  accountId: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  // Gets the account from database
  const account = await prisma.instaAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error(ERROR_MESSAGES.AUTH.NO_INSTAGRAM_ACCOUNT);
  }

  // Refreshes the token using Instagram Graph API
  // Uses ig_refresh_token grant type for long-lived token refresh
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: account.accessToken,
  });

  const url = `https://graph.instagram.com/refresh_access_token?${params.toString()}`;

  const { fetchWithTimeout } = await import("../utils/fetch-with-timeout");

  try {
    const result = await fetchWithTimeout<RefreshTokenResponse>(url, {
      method: "GET",
      timeout: 15000,
      retries: 2,
    });

    const data = result.data;

    // Calculates new expiration date
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    // Updates the database
    await prisma.instaAccount.update({
      where: { id: accountId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: expiresAt,
        lastSyncedAt: new Date(),
      },
    });

    return {
      accessToken: data.access_token,
      expiresAt,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : ERROR_MESSAGES.AUTH.TOKEN_EXPIRED;
    throw new Error(errorMessage);
  }
}

/**
 * Checks if a token is expired or will expire soon
 */
export function isTokenExpiringSoon(
  expiresAt: Date,
  daysThreshold: number = 7,
): boolean {
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

  return expiresAt <= thresholdDate;
}

/**
 * Gets a valid access token, refreshing if needed
 */
export async function getValidAccessToken(accountId: string): Promise<string> {
  const account = await prisma.instaAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error(ERROR_MESSAGES.AUTH.NO_INSTAGRAM_ACCOUNT);
  }

  // Checks if token needs refresh (within 7 days of expiry)
  if (isTokenExpiringSoon(account.tokenExpiresAt)) {
    const { accessToken } = await refreshAccessToken(accountId);
    return accessToken;
  }

  return account.accessToken;
}
