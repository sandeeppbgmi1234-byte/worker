import { logger } from "../logger";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/db";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";

import { DatabaseError, DatabaseErrorType } from "../errors";
export { DatabaseError, DatabaseErrorType };

export function isDuplicateKeyError(error: unknown): boolean {
  return classifyPrismaError(error) === DatabaseErrorType.UNIQUE_CONSTRAINT;
}

export function classifyPrismaError(error: unknown): DatabaseErrorType {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return DatabaseErrorType.UNIQUE_CONSTRAINT;
    if (error.code === "P2003") return DatabaseErrorType.FOREIGN_KEY;
    if (error.code === "P2025") return DatabaseErrorType.NOT_FOUND;
  }
  if (error instanceof Prisma.PrismaClientValidationError)
    return DatabaseErrorType.VALIDATION;
  if (error instanceof Prisma.PrismaClientInitializationError)
    return DatabaseErrorType.CONNECTION;
  if (error instanceof Prisma.PrismaClientRustPanicError)
    return DatabaseErrorType.CONNECTION;
  return DatabaseErrorType.UNKNOWN;
}

export function isRetryableError(error: unknown): boolean {
  const errorType = classifyPrismaError(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2010") return true;
    if (
      error.message.includes("TransientTransactionError") ||
      error.message.includes("peer closed connection") ||
      error.message.includes("TLS close_notify")
    ) {
      return true;
    }
  }
  return errorType === DatabaseErrorType.CONNECTION;
}

export async function executeWithErrorHandling<T>(
  operation: () => Promise<T | null>,
  context: {
    operation: string;
    model?: string;
    retries?: number;
  },
): Promise<Result<T, DatabaseError>> {
  const { operation: opName, model, retries = 0 } = context;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await operation();
      if (result === null) {
        return fail(
          new DatabaseError(
            opName,
            "Record not found",
            DatabaseErrorType.NOT_FOUND,
            { model },
          ),
        );
      }
      return ok(result);
    } catch (error) {
      lastError = error;
      const errorType = classifyPrismaError(error);

      logger.error(
        {
          operation: opName,
          model,
          attempt: attempt + 1,
          maxRetries: retries,
          errorType,
        },
        `Database operation failed: ${opName}`,
      );

      if (isRetryableError(error) && attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return fail(
        new DatabaseError(
          opName,
          `Failed to execute ${opName} on ${model}`,
          errorType,
          { model },
          error,
        ),
      );
    }
  }

  return fail(
    new DatabaseError(
      opName,
      "Max retries exceeded",
      DatabaseErrorType.UNKNOWN,
      { model },
      lastError,
    ),
  );
}

export async function executeTransaction<T>(
  operations: (tx: Prisma.TransactionClient) => Promise<T>,
  context: {
    operation: string;
    models?: string[];
    retries?: number;
  },
): Promise<Result<T, DatabaseError>> {
  const { operation: opName, models, retries = 3 } = context;
  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await prisma.$transaction(operations, { timeout: 10000 });
      return ok(result);
    } catch (error) {
      lastError = error;
      const errorType = classifyPrismaError(error);
      const isRetryable = isRetryableError(error);

      logger.error(
        {
          operation: opName,
          models: models || [],
          duration: `${Date.now() - startTime}ms`,
          errorType,
          attempt: attempt + 1,
          maxRetries: retries,
          isRetryable,
        },
        `Transaction failed: ${opName}`,
      );

      if (isRetryable && attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return fail(
        new DatabaseError(
          opName,
          "Transaction failed",
          errorType,
          { models },
          error,
        ),
      );
    }
  }

  return fail(
    new DatabaseError(
      opName,
      "Transaction max retries exceeded",
      DatabaseErrorType.UNKNOWN,
      { models },
      lastError,
    ),
  );
}
