import process from "node:process";
import chalk from "chalk";
import { runAegisCli } from "./aegis.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (!args.length) {
    console.log(chalk.cyan("AegisNexus CLI Gateway"));
    console.log("Usage:");
    console.log("  node dist/index.js aegis gateway start");
    console.log("  node dist/index.js aegis configure");
    console.log("  node dist/index.js gateway start");
    return;
  }

  if (args[0] === "aegis") {
    await runAegisCli(["node", "aegis", ...args.slice(1)]);
    return;
  }

  await runAegisCli(["node", "aegis", ...args]);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(`Error: ${message}`));
  process.exitCode = 1;
});
