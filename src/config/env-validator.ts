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
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !(process.env[key] || "").trim(),
  );

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
  const portErrors: string[] = [];

  for (const key of portChecks) {
    const portStr = (process.env[key] || "").trim();
    const val = parseInt(portStr, 10);

    // Tighten validation: decimal digits only, valid range
    if (!/^\d+$/.test(portStr) || isNaN(val) || val < 1 || val > 65535) {
      portErrors.push(
        `Environment variable '${key}' must be a valid decimal TCP port (1-65535). Received: '${portStr}'`,
      );
    }
  }

  if (portErrors.length > 0) {
    const errorMsg = `CONFIGURATION ERROR:\n${portErrors
      .map((e) => ` - ${e}`)
      .join("\n")}`;
    logger.error({ portErrors }, errorMsg);
    throw new Error(errorMsg);
  }

  const encryptionSecret = (process.env.REDIS_ENCRYPTION_SECRET || "").trim();
  if (encryptionSecret.length < 32) {
    const errorMsg =
      "CONFIGURATION ERROR: REDIS_ENCRYPTION_SECRET must be at least 32 characters long to ensure adequate entropy for token encryption.";
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  logger.info("Environment validation successful.");
}
