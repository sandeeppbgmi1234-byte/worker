# Worker Service Deployment

## Render Deployment

The worker service is configured for deployment on Render using the `render.yaml` file.

**Note:** When setting up the service in Render, set the **Root Directory** to the project root (not `packages/worker`). The build commands in `render.yaml` handle the worker directory automatically.

### Required Environment Variables

Set these in your Render dashboard:

- `DATABASE_URL` - MongoDB connection string
- `UPSTASH_REDIS_HOST` - Upstash Redis host
- `UPSTASH_REDIS_USERNAME` - Upstash Redis username
- `UPSTASH_REDIS_PASSWORD` - Upstash Redis password
- `WORKER_PORT` - Port for the worker service (defaults to 8080)
- `NODE_ENV` - Set to `production`

### Build Process

1. Installs dependencies at root and worker level
2. Generates Prisma client
3. Builds the worker bundle with Bun (targeting Bun runtime)

### Health Check

The service exposes a `/health` endpoint that checks:
- Database connection
- Redis connection
- BullMQ worker status

### Local Development

```bash
# Development mode with watch
npm run dev

# Production build
npm run build

# Start production build
npm start
```
