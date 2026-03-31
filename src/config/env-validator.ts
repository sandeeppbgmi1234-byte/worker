import { logger } from "../logger";

const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "UPSTASH_REDIS_HOST",
  "UPSTASH_REDIS_PORT",
  "UPSTASH_REDIS_PASSWORD",
  "QUEUE_REDIS_HOST",
  "QUEUE_REDIS_PORT",
  "QUEUE_REDIS_PASSWORD",
  "INSTAGRAM_API_VERSION",
  "REDIS_ENCRYPTION_SECRET",
] as const;

/**
 * Validates all required environment variables at startup.
 * Throws a comprehensive error report if any are missing.
 */
export function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    const errorMsg = `
CRITICAL CONFIGURATION ERROR:
The following required environment variables are missing:
${missing.map((key) => ` - ${key}`).join("\n")}

The worker service cannot start safely without these values.
Please update your .env file or deployment environment.
    `;

    logger.error({ missing }, "Missing environment variables");
    throw new Error(errorMsg);
  }

  // Type-specific validations
  const portChecks = ["UPSTASH_REDIS_PORT", "QUEUE_REDIS_PORT"];
  for (const key of portChecks) {
    const val = Number(process.env[key]);
    if (isNaN(val)) {
      throw new Error(
        `CONFIGURATION ERROR: Environment variable '${key}' must be a valid number.`,
      );
    }
  }

  logger.info("Environment validation successful.");
}
