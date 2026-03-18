export type HealthStatus = "UP" | "DOWN" | "DEGRADED";

export interface ServiceHealth {
  status: HealthStatus;
  latency?: number;
  details?: Record<string, any>;
}

export interface SystemHealth {
  status: HealthStatus;
  uptime: number; // in seconds
  timestamp: string;
  memory: {
    free: number;
    total: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    queueRedis: ServiceHealth;
    bullmqWorker: ServiceHealth;
  };
}
