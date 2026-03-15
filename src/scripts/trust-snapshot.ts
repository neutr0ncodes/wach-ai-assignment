#!/usr/bin/env npx tsx
/**
 * CLI to print a trust snapshot for an agent.
 *
 * Usage:
 *   npx tsx scripts/trust-snapshot.ts --agentId 0xABC123
 *   npx ts-node scripts/trust-snapshot.ts --agentId 0xABC123
 */

import "dotenv/config";
import { fetchTrustByAgentId } from "../router/trustFetcher.js";

function parseArgs(): { agentId: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--agentId");
  if (idx === -1 || !args[idx + 1]) {
    console.error("Usage: npx tsx scripts/trust-snapshot.ts --agentId <agentId>");
    process.exit(1);
  }
  return { agentId: args[idx + 1]! };
}

async function main(): Promise<void> {
  const { agentId } = parseArgs();

  const data = await fetchTrustByAgentId(agentId);

  if (data === null) {
    console.error("Agent not found or invalid agentId:", agentId);
    process.exit(1);
  }

  const latestDate =
    data.latestValidationAt > 0
      ? new Date(data.latestValidationAt * 1000).toISOString().slice(0, 10)
      : "N/A";

  console.log("Agent:", data.agentId);
  console.log("Validations:", data.validationCount);
  console.log("Avg Score:", data.averageScore);
  console.log(
    "Latest Score:",
    data.latestScore,
    `(${latestDate})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
