import { prisma } from "../db/db";
import { executeWithErrorHandling, DatabaseError } from "./repository-utils";
import { Result } from "../helpers/result";

const INSTA_ACCOUNT_SELECT = {
  id: true,
  userId: true,
  username: true,
  accessToken: true,
  instagramUserId: true,
  webhookUserId: true,
  isActive: true,
  user: { select: { clerkId: true } },
} as const;

export interface InstaAccountWithClerk {
  id: string;
  userId: string;
  username: string;
  accessToken: string;
  instagramUserId: string;
  webhookUserId: string | null;
  isActive: boolean;
  user: {
    clerkId: string;
  };
}

export async function findInstaAccountByPlatformId(
  platformId: string,
): Promise<Result<InstaAccountWithClerk, DatabaseError>> {
  const idString = String(platformId);

  const fallbackLookup = async () => {
    const byWebhookId = await prisma.instaAccount.findUnique({
      where: { webhookUserId: idString },
      select: INSTA_ACCOUNT_SELECT,
    });

    if (byWebhookId) return byWebhookId;

    return prisma.instaAccount.findUnique({
      where: { instagramUserId: idString },
      select: INSTA_ACCOUNT_SELECT,
    });
  };

  return executeWithErrorHandling(fallbackLookup, {
    operation: "findInstaAccountByPlatformId",
    model: "InstaAccount",
    retries: 1,
  });
}
