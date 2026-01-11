/**
 * Prisma Client for Worker
 * Database connection for worker service
 */

import { PrismaClient } from "@prisma/client";

// Creates Prisma client instance
const createPrismaClient = () => {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
};

export const prisma: PrismaClient = createPrismaClient();

