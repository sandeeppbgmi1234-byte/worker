import { prisma } from "../db/db";
import { executeWithErrorHandling, DatabaseError } from "./repository-utils";
import { Result } from "../helpers/result";
import type { Automation } from "@prisma/client";

// All queries scoped to instaAccountId — never userId — for strict account isolation
export async function findActiveAutomationsByPost(
  instaAccountId: string,
  postId: string,
): Promise<Result<Automation[], DatabaseError>> {
  return executeWithErrorHandling(
    async () => {
      const result = await prisma.automation.findMany({
        where: {
          instaAccountId,
          post: { is: { id: postId } },
          status: "ACTIVE",
        },
        orderBy: { createdAt: "desc" },
      });
      return result;
    },
    {
      operation: "findActiveAutomationsByPost",
      model: "Automation",
      retries: 1,
    },
  );
}

export async function findActiveAutomationsByStory(
  instaAccountId: string,
  storyId: string,
): Promise<Result<Automation[], DatabaseError>> {
  return executeWithErrorHandling(
    async () => {
      const result = await prisma.automation.findMany({
        where: {
          instaAccountId,
          story: { is: { id: storyId } },
          status: "ACTIVE",
        },
        orderBy: { createdAt: "desc" },
      });
      return result;
    },
    {
      operation: "findActiveAutomationsByStory",
      model: "Automation",
      retries: 1,
    },
  );
}

export async function findAutomationById(
  automationId: string,
): Promise<Result<Automation | null, DatabaseError>> {
  return executeWithErrorHandling(
    async () => {
      const result = await prisma.automation.findUnique({
        where: { id: automationId },
      });
      return result;
    },
    {
      operation: "findAutomationById",
      model: "Automation",
      retries: 1,
    },
  );
}

export async function findActiveAutomationsForAccountDM(
  instaAccountId: string,
): Promise<Result<Automation[], DatabaseError>> {
  return executeWithErrorHandling(
    async () => {
      const result = await prisma.automation.findMany({
        where: {
          instaAccountId,
          triggerType: "RESPOND_TO_ALL_DMS",
          status: "ACTIVE",
        },
        orderBy: { createdAt: "desc" },
      });
      return result;
    },
    {
      operation: "findActiveAutomationsForAccountDM",
      model: "Automation",
      retries: 1,
    },
  );
}
