import { prisma } from "../db/db";
import { ERROR_MESSAGES } from "../config/instagram.config";
import { fetchFromInstagram } from "./gateway";
import { RefreshTokenResponse } from "../types/instagram.types";

export async function refreshAccessToken(
  accountId: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const account = await prisma.instaAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) throw new Error(ERROR_MESSAGES.AUTH.NO_INSTAGRAM_ACCOUNT);

  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: account.accessToken,
  });

  const url = `https://graph.instagram.com/refresh_access_token?${params.toString()}`;
  const response = await fetchFromInstagram<RefreshTokenResponse>(url, {
    method: "GET",
    timeoutMs: 15000,
    retries: 2,
    instagramUserId: accountId,
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
