import { prisma } from "../db/db";
import { executeWithErrorHandling, DatabaseError } from "./repository-utils";
import { Result, ok, fail } from "../helpers/result";

export async function findInstaAccountByInstagramUserId(
  instagramUserId: string,
): Promise<Result<any, DatabaseError>> {
  const userIdString = String(instagramUserId);

  const fallbackLookup = async () => {
    let instaAccount = await prisma.instaAccount.findUnique({
      where: { webhookUserId: userIdString },
      select: {
        id: true,
        userId: true,
        accessToken: true,
        instagramUserId: true,
        webhookUserId: true,
        isActive: true,
        user: { select: { clerkId: true } },
      },
    });

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
          user: { select: { clerkId: true } },
        },
      });
    }

    return instaAccount;
  };

  return executeWithErrorHandling(fallbackLookup, {
    operation: "findInstaAccountByInstagramUserId",
    model: "InstaAccount",
    retries: 1,
  });
}
