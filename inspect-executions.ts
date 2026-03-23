import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function run() {
  try {
    const executions = await prisma.automationExecution.findMany({
      orderBy: { executedAt: "desc" },
      take: 5,
    });
    console.log(JSON.stringify(executions, null, 2));
  } catch (error) {
    console.error("Error inspecting executions:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
run();
