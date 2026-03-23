import { Queue } from "bullmq";
import { QUEUE_CONNECTION } from "./src/config/redis.config";
import { WORKER_CONFIG } from "./src/config/worker.config";

const q = new Queue(WORKER_CONFIG.QUEUE_NAME, { connection: QUEUE_CONNECTION });
async function run() {
  try {
    const counts = await q.getJobCounts();
    console.log("Queue counts:", counts);
  } catch (error) {
    console.error("Error inspecting queue:", error);
    process.exit(1);
  } finally {
    await q.close();
  }
}
run();
