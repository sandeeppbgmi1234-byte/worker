import { aggregateHealthStatus } from "../index";
import { logger } from "../../logger";

async function runTest() {
  logger.info("Executing Full System Health Check...");

  // No worker available in this context, passing null
  const health = await aggregateHealthStatus(null);

  console.log(JSON.stringify(health, null, 2));

  if (health.status !== "UP") {
    logger.error("❌ System Health check failed for some services.");
    process.exit(1);
  } else {
    logger.info("✅ All systems operational.");
  }
}

runTest().catch(console.error);
