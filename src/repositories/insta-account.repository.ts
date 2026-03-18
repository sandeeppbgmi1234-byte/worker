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

export async function findInstaAccountByInstagramUserId(
  instagramUserId: string,
): Promise<Result<any, DatabaseError>> {
  const userIdString = String(instagramUserId);

  const fallbackLookup = async () => {
    const byWebhookId = await prisma.instaAccount.findUnique({
      where: { webhookUserId: userIdString },
      select: INSTA_ACCOUNT_SELECT,
    });

    if (byWebhookId) return byWebhookId;

    return prisma.instaAccount.findUnique({
      where: { instagramUserId: userIdString },
      select: INSTA_ACCOUNT_SELECT,
    });
  };

  return executeWithErrorHandling(fallbackLookup, {
    operation: "findInstaAccountByInstagramUserId",
    model: "InstaAccount",
    retries: 1,
  });
}
