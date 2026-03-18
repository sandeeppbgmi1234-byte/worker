import * as os from "os";

export function getSystemMetrics() {
  const memoryUsage = process.memoryUsage();
  return {
    uptime: process.uptime(), // seconds
    timestamp: new Date().toISOString(),
    os: {
      platform: os.platform(),
      release: os.release(),
      loadavg: os.loadavg(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      cpusCount: os.cpus().length,
    },
    memory: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
    },
  };
}
