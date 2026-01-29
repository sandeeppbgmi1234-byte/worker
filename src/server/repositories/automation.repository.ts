/**
 * Automation Repository
 * Data access layer for Automation model operations
 */

import { prisma } from "../../db/db";
import { executeWithErrorHandling } from "./repository-utils";

export interface CreateAutomationData {
  userId: string;
  postId: string;
  postCaption?: string | null;
  triggers: string[];
  matchType: string;
  actionType: string;
  replyMessage: string;
  useVariables: boolean;
  status?: string;
  commentReplyWhenDm?: string | null;
}

export interface UpdateAutomationData {
  postCaption?: string | null;
  triggers?: string[];
  matchType?: string;
  actionType?: string;
  replyMessage?: string;
  commentReplyWhenDm?: string | null;
  useVariables?: boolean;
  status?: string;
}

export interface AutomationFilters {
  userId?: string;
  postId?: string;
  status?: string;
  skip?: number;
  take?: number;
}

/**
 * Creates a new automation
 */
export async function createAutomation(
  userId: string,
  data: CreateAutomationData
) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.create({
        data: {
          userId: data.userId,
          postId: data.postId,
          postCaption: data.postCaption,
          triggers: data.triggers,
          matchType: data.matchType,
          actionType: data.actionType,
          replyMessage: data.replyMessage,
          useVariables: data.useVariables,
          status: data.status || "ACTIVE",
          commentReplyWhenDm: data.commentReplyWhenDm,
        },
      }),
    {
      operation: "createAutomation",
      model: "Automation",
      retries: 1,
    }
  );
}

/**
 * Finds an automation by ID
 */
export async function findAutomationById(automationId: string) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findUnique({
        where: { id: automationId },
      }),
    {
      operation: "findAutomationById",
      model: "Automation",
      fallback: null, // Returns null if not found or on error
      retries: 1,
    }
  );
}

/**
 * Finds an automation by ID with executions
 */
export async function findAutomationByIdWithExecutions(automationId: string) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findUnique({
        where: { id: automationId },
        include: {
          executions: {
            orderBy: {
              executedAt: "desc",
            },
            take: 10,
          },
          _count: {
            select: {
              executions: true,
            },
          },
        },
      }),
    {
      operation: "findAutomationByIdWithExecutions",
      model: "Automation",
      fallback: null, // Returns null if not found or on error
      retries: 1,
    }
  );
}

/**
 * Finds an automation by ID and userId (authorized query)
 * Returns null if automation doesn't exist or user doesn't own it
 * This prevents information disclosure by checking ownership in the query
 */
export async function findAutomationByIdAndUserId(
  automationId: string,
  userId: string
) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findFirst({
        where: {
          id: automationId,
          userId: userId, // Checks ownership in the query
        },
        include: {
          executions: {
            orderBy: {
              executedAt: "desc",
            },
            take: 10,
          },
          _count: {
            select: {
              executions: true,
            },
          },
        },
      }),
    {
      operation: "findAutomationByIdAndUserId",
      model: "Automation",
      fallback: null, // Returns null if not found or on error
      retries: 1,
    }
  );
}

/**
 * Finds an automation by ID and userId (for update/delete operations)
 * Returns null if automation doesn't exist or user doesn't own it
 */
export async function findAutomationByIdAndUserIdForUpdate(
  automationId: string,
  userId: string
) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findFirst({
        where: {
          id: automationId,
          userId: userId, // Checks ownership in the query
        },
      }),
    {
      operation: "findAutomationByIdAndUserIdForUpdate",
      model: "Automation",
      fallback: null, // Returns null if not found or on error
      retries: 1,
    }
  );
}

/**
 * Finds automations with filters
 */
export async function findUserAutomations(filters: AutomationFilters) {
  return executeWithErrorHandling(
    () => {
      const where: any = {};

      if (filters.userId) {
        where.userId = filters.userId;
      }

      if (filters.postId) {
        where.postId = filters.postId;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      return prisma.automation.findMany({
        where,
        include: {
          _count: {
            select: {
              executions: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: filters.skip,
        take: filters.take,
      });
    },
    {
      operation: "findUserAutomations",
      model: "Automation",
      fallback: [], // Returns empty array on error
      retries: 1,
    }
  );
}

/**
 * Counts automations with filters (for pagination)
 */
export async function countAutomations(
  filters: AutomationFilters
): Promise<number> {
  return executeWithErrorHandling(
    () => {
      const where: any = {};

      if (filters.userId) {
        where.userId = filters.userId;
      }

      if (filters.postId) {
        where.postId = filters.postId;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      return prisma.automation.count({ where });
    },
    {
      operation: "countAutomations",
      model: "Automation",
      fallback: 0, // Returns 0 on error
      retries: 1,
    }
  );
}

/**
 * Finds active automations for a specific post
 */
export async function findActiveAutomationsByPost(
  userId: string,
  postId: string
) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.findMany({
        where: {
          userId,
          postId,
          status: "ACTIVE",
        },
      }),
    {
      operation: "findActiveAutomationsByPost",
      model: "Automation",
      fallback: [], // Returns empty array on error (allows webhook to continue)
      retries: 1,
    }
  );
}

/**
 * Updates an automation
 */
export async function updateAutomation(
  automationId: string,
  data: UpdateAutomationData
) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.update({
        where: { id: automationId },
        data,
      }),
    {
      operation: "updateAutomation",
      model: "Automation",
      retries: 1,
    }
  );
}

/**
 * Updates automation trigger stats
 * Fails silently to prevent blocking automation execution
 */
export async function updateAutomationStats(automationId: string) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.update({
        where: { id: automationId },
        data: {
          timesTriggered: {
            increment: 1,
          },
          lastTriggeredAt: new Date(),
        },
      }),
    {
      operation: "updateAutomationStats",
      model: "Automation",
      fallback: null, // Stats update failure shouldn't block execution
      retries: 1,
    }
  );
}

/**
 * Soft deletes an automation (marks as DELETED)
 */
export async function softDeleteAutomation(automationId: string) {
  return executeWithErrorHandling(
    () =>
      prisma.automation.update({
        where: { id: automationId },
        data: { status: "DELETED" },
      }),
    {
      operation: "softDeleteAutomation",
      model: "Automation",
      retries: 1,
    }
  );
}
