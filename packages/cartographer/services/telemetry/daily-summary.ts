#!/usr/bin/env node
/**
 * Daily Cost Summary — prints per-activity and per-phase LLM cost aggregations.
 * Usage: node --import tsx services/telemetry/daily-summary.ts
 */

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../.telemetry/llm-costs.db");

if (!existsSync(DB_PATH)) {
  console.log("No telemetry database found. No costs recorded yet.");
  process.exit(0);
}

const db = new Database(DB_PATH, { readonly: true });

console.log("=== CBC Cartographer — LLM Cost Summary ===\n");

// Per-phase summary
const phaseRows = db.prepare(`
  SELECT
    phase,
    COUNT(*) as calls,
    SUM(input_tokens) as total_input,
    SUM(output_tokens) as total_output,
    ROUND(SUM(cost_usd), 4) as total_cost
  FROM llm_costs
  GROUP BY phase
  ORDER BY total_cost DESC
`).all() as Array<{ phase: string; calls: number; total_input: number; total_output: number; total_cost: number }>;

console.log("By Phase:");
console.log("─".repeat(70));
console.log(
  "Phase".padEnd(15) +
  "Calls".padStart(8) +
  "Input Tok".padStart(12) +
  "Output Tok".padStart(12) +
  "Cost (USD)".padStart(12)
);
console.log("─".repeat(70));
for (const row of phaseRows) {
  console.log(
    row.phase.padEnd(15) +
    String(row.calls).padStart(8) +
    String(row.total_input).padStart(12) +
    String(row.total_output).padStart(12) +
    `$${row.total_cost.toFixed(4)}`.padStart(12)
  );
}

// Per-activity summary
const activityRows = db.prepare(`
  SELECT
    COALESCE(activity_id, '(general)') as activity,
    COUNT(*) as calls,
    ROUND(SUM(cost_usd), 4) as total_cost
  FROM llm_costs
  GROUP BY activity_id
  ORDER BY total_cost DESC
`).all() as Array<{ activity: string; calls: number; total_cost: number }>;

console.log("\nBy Activity:");
console.log("─".repeat(50));
console.log(
  "Activity".padEnd(30) +
  "Calls".padStart(8) +
  "Cost (USD)".padStart(12)
);
console.log("─".repeat(50));
for (const row of activityRows) {
  console.log(
    row.activity.padEnd(30) +
    String(row.calls).padStart(8) +
    `$${row.total_cost.toFixed(4)}`.padStart(12)
  );
}

// Grand total
const total = db.prepare(`
  SELECT ROUND(SUM(cost_usd), 4) as total FROM llm_costs
`).get() as { total: number };

console.log("\n" + "═".repeat(50));
console.log(`TOTAL: $${(total?.total ?? 0).toFixed(4)}`);
console.log("═".repeat(50));

db.close();
