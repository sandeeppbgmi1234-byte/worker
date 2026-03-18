import { checkDatabase } from "../service-checks";
import { logger } from "../../logger";

async function runTest() {
  logger.info("Testing Database Connection...");
  const result = await checkDatabase();

  if (result.status === "UP") {
    logger.info(
      `✅ Database connected successfully! Latency: ${result.latency}ms`,
    );
  } else {
    logger.error(`❌ Database connection failed: ${result.details?.error}`);
    process.exit(1);
  }
}

runTest().catch(console.error);
