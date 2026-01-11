/**
 * Worker Service Entry Point
 * Express server for processing background jobs
 */

import express from "express";
import { setupWorker } from "./worker";

const app = express();
const PORT = process.env.WORKER_PORT || 8080;

// Middleware
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    report: "ok",
    service: "worker",
    timestamp: new Date().toISOString(),
  });
});

// Starts the BullMQ worker
try {
  setupWorker();
} catch (error) {
  console.error("❌ Failed to start worker:", error);
  process.exit(1);
}

// Starts the Express server
app.listen(PORT, () => {
  console.log(`🚀 Worker service running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
