import Database from "better-sqlite3";
import type { Job, JobType, JobStatus, OrchestratorAPI } from "../../contracts/orchestrator-api.js";
import type { LifecyclePhase } from "../../contracts/mcp-tools.js";
import type { StoreAPI } from "../../contracts/store-api.js";
import { PHASE_PREREQUISITES, isPhaseAtLeast, TERMINAL_STATUSES } from "./lifecycle-rules.js";

export interface OrchestratorOptions {
  dbPath?: string;
}

export class Orchestrator implements OrchestratorAPI {
  private db: Database.Database;
  private store: StoreAPI;

  constructor(store: StoreAPI, options?: OrchestratorOptions) {
    this.store = store;
    this.db = new Database(options?.dbPath ?? ":memory:");
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id            TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        activity_id   TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'queued',
        params_json   TEXT,
        result_json   TEXT,
        error         TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        started_at    TEXT,
        completed_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_activity ON jobs(activity_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `);
  }

  async submit(
    type: JobType,
    activityId: string,
    params?: Record<string, unknown>
  ): Promise<Job> {
    const requiredPhase = PHASE_PREREQUISITES[type];
    let status: JobStatus = "queued";

    if (requiredPhase !== null) {
      const currentPhase = await this.store.getLifecyclePhase(activityId);
      if (!isPhaseAtLeast(currentPhase, requiredPhase)) {
        status = "blocked";
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO jobs (id, type, activity_id, status, params_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, type, activityId, status, params ? JSON.stringify(params) : null, now);

    return this.rowToJob(
      this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow
    );
  }

  async getJob(jobId: string): Promise<Job | null> {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
      | JobRow
      | undefined;
    return row ? this.rowToJob(row) : null;
  }

  async listJobs(
    filter?: { activity_id?: string; status?: JobStatus; type?: JobType }
  ): Promise<Job[]> {
    let sql = "SELECT * FROM jobs WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.activity_id) {
      sql += " AND activity_id = ?";
      params.push(filter.activity_id);
    }
    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }
    if (filter?.type) {
      sql += " AND type = ?";
      params.push(filter.type);
    }

    sql += " ORDER BY created_at DESC";

    const rows = this.db.prepare(sql).all(...params) as JobRow[];
    return rows.map((r) => this.rowToJob(r));
  }

  async cancelJob(jobId: string): Promise<void> {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
      | JobRow
      | undefined;

    if (!row) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (TERMINAL_STATUSES.has(row.status as JobStatus)) {
      throw new Error(`Job ${jobId} is already in terminal state: ${row.status}`);
    }

    this.db
      .prepare("UPDATE jobs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?")
      .run(jobId);
  }

  async getRequiredPhase(
    _activityId: string,
    requestedAction: JobType
  ): Promise<LifecyclePhase> {
    return PHASE_PREREQUISITES[requestedAction] ?? "unresearched";
  }

  async isPhaseComplete(activityId: string, phase: LifecyclePhase): Promise<boolean> {
    const currentPhase = await this.store.getLifecyclePhase(activityId);
    return isPhaseAtLeast(currentPhase, phase);
  }

  updateJobStatus(jobId: string, status: JobStatus, result?: unknown, error?: string): void {
    const updates: string[] = ["status = ?"];
    const params: unknown[] = [status];

    if (status === "running") {
      updates.push("started_at = datetime('now')");
    }
    if (TERMINAL_STATUSES.has(status)) {
      updates.push("completed_at = datetime('now')");
    }
    if (result !== undefined) {
      updates.push("result_json = ?");
      params.push(JSON.stringify(result));
    }
    if (error !== undefined) {
      updates.push("error = ?");
      params.push(error);
    }

    params.push(jobId);
    this.db.prepare(`UPDATE jobs SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  close(): void {
    this.db.close();
  }

  private rowToJob(row: JobRow): Job {
    return {
      id: row.id,
      type: row.type as JobType,
      activity_id: row.activity_id,
      status: row.status as JobStatus,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      error: row.error,
      result: row.result_json ? JSON.parse(row.result_json) : null,
    };
  }
}

interface JobRow {
  id: string;
  type: string;
  activity_id: string;
  status: string;
  params_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
