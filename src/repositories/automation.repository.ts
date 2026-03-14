import { prisma } from "../db/db";
import { executeWithErrorHandling, DatabaseError } from "./repository-utils";
import { Result } from "../helpers/result";
import type { Automation } from "@prisma/client";

export async function findActiveAutomationsByPost(
  userId: string,
  postId: string,
): Promise<Result<Automation[], DatabaseError>> {
  return executeWithErrorHandling(
    async () => {
      const result = await prisma.automation.findMany({
        where: { userId, post: { is: { id: postId } }, status: "ACTIVE" },
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
  userId: string,
  storyId: string,
): Promise<Result<Automation[], DatabaseError>> {
  return executeWithErrorHandling(
    async () => {
      const result = await prisma.automation.findMany({
        where: { userId, story: { is: { id: storyId } }, status: "ACTIVE" },
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
