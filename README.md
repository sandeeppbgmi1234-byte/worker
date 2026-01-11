# Worker Service

Express server with BullMQ worker for processing background jobs.

## Setup

1. **Start Redis** (using Docker Compose):

   ```bash
   npm run docker:up
   # or
   docker-compose up -d
   ```

2. **Environment Variables**:
   Create a `.env` file in the worker directory:

   ```env
   REDIS_URL=redis://localhost:6379
   WORKER_PORT=8080
   DATABASE_URL=your_mongodb_connection_string
   ```

3. **Run the worker**:
   ```bash
   npm run dev:worker
   # or from root
   cd packages/worker && bun run dev
   ```

## Services

- **Express Server**: Health check endpoint on port 3001
- **BullMQ Worker**: Processes jobs from `webhook-processing` queue
- **Redis**: Queue backend (runs in Docker)
- **RedisInsight**: GUI for Redis (http://localhost:5540)

## Docker Commands

- `npm run docker:up` - Start Redis and RedisInsight
- `npm run docker:down` - Stop containers
- `npm run docker:logs` - View logs
- `npm run docker:restart` - Restart containers
