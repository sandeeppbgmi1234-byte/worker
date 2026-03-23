import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function run() {
  const executions = await prisma.automationExecution.findMany({
    orderBy: { executedAt: "desc" },
    take: 5,
  });
  console.log(JSON.stringify(executions, null, 2));
  process.exit(0);
}
run();
