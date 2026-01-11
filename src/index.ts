import express from "express";

const app = express();
const PORT = process.env.WORKER_PORT || 3001;

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

// Starts the server
app.listen(PORT, () => {
  console.log(`🚀 Worker service running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
