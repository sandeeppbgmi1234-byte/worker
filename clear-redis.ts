import { Redis } from "ioredis";

async function main() {
  const redis = new Redis("rediss://default:AVd9AAIncDIzYzhhMDlkNmFiMjA0N2MzYmY0NzNkOWIwZGI0MjMxYnAyMjIzOTc@thorough-beetle-22397.upstash.io:6379");
  await redis.flushdb();
  console.log("Upstash Redis cleared entirely.");
  process.exit(0);
}

main();
