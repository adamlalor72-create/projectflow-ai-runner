/**
 * Telemetry — LLM Cost Logger
 * Logs LLM API calls to a local SQLite database for cost tracking.
 */

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, "../../.telemetry");
const DB_PATH = path.join(DB_DIR, "llm-costs.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS llm_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      agent_name TEXT NOT NULL,
      activity_id TEXT,
      phase TEXT NOT NULL CHECK (phase IN ('research', 'discovery', 'verify', 'repair', 'other')),
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL
    )
  `);
  return _db;
}

export type Phase = "research" | "discovery" | "verify" | "repair" | "other";

export interface CostEntry {
  agent_name: string;
  activity_id?: string | null;
  phase: Phase;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export function logCost(entry: CostEntry): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO llm_costs (agent_name, activity_id, phase, model, input_tokens, output_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.agent_name,
    entry.activity_id ?? null,
    entry.phase,
    entry.model,
    entry.input_tokens,
    entry.output_tokens,
    entry.cost_usd
  );
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
