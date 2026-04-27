import Database from "better-sqlite3";
import type { StoreAPI } from "../../contracts/store-api.js";
import type { UIMap, TestRecord, DriftSignal } from "../../contracts/types/ui-map.js";
import type { LifecyclePhase } from "../../contracts/mcp-tools.js";
import { validateUIMap } from "./schema-validator.js";
import { runMigrations } from "./migrations.js";

export interface MapStoreOptions {
  dbPath?: string;
}

export class MapStore implements StoreAPI {
  private db: Database.Database;

  constructor(options?: MapStoreOptions) {
    this.db = new Database(options?.dbPath ?? ":memory:");
    this.db.pragma("journal_mode = WAL");
    runMigrations(this.db);
  }

  async getMap(activityId: string): Promise<UIMap | null> {
    const row = this.db
      .prepare("SELECT map_json FROM maps WHERE activity_id = ? ORDER BY version DESC LIMIT 1")
      .get(activityId) as { map_json: string } | undefined;
    return row ? (JSON.parse(row.map_json) as UIMap) : null;
  }

  async saveMap(map: UIMap): Promise<void> {
    const valid = validateUIMap(map);
    if (!valid) {
      const detail = JSON.stringify(validateUIMap.errors, null, 2);
      throw new Error(`UIMap validation failed: ${detail}`);
    }

    const txn = this.db.transaction(() => {
      const maxRow = this.db
        .prepare("SELECT MAX(version) as max_v FROM maps WHERE activity_id = ?")
        .get(map.activity_id) as { max_v: number | null };
      const nextVersion = (maxRow.max_v ?? 0) + 1;

      const stored = { ...map, version: nextVersion };

      this.db
        .prepare(
          `INSERT INTO maps (activity_id, version, name, verified, verified_at, map_json)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          stored.activity_id,
          stored.version,
          stored.name,
          stored.verified ? 1 : 0,
          stored.verified_at ?? null,
          JSON.stringify(stored)
        );

      this.db
        .prepare("INSERT OR IGNORE INTO lifecycle (activity_id, phase) VALUES (?, 'unresearched')")
        .run(stored.activity_id);
    });

    txn();
  }

  async listActivities(
    filter?: { verified?: boolean; lifecycle_phase?: LifecyclePhase }
  ): Promise<
    Array<{
      activity_id: string;
      name: string;
      version: number;
      verified: boolean;
      lifecycle_phase: LifecyclePhase;
    }>
  > {
    let sql = `
      SELECT m.activity_id, m.name, m.version, m.verified, l.phase as lifecycle_phase
      FROM maps m
      JOIN lifecycle l ON m.activity_id = l.activity_id
      WHERE m.version = (SELECT MAX(version) FROM maps WHERE activity_id = m.activity_id)
    `;
    const params: unknown[] = [];

    if (filter?.verified !== undefined) {
      sql += " AND m.verified = ?";
      params.push(filter.verified ? 1 : 0);
    }
    if (filter?.lifecycle_phase !== undefined) {
      sql += " AND l.phase = ?";
      params.push(filter.lifecycle_phase);
    }

    sql += " ORDER BY m.activity_id";

    const rows = this.db.prepare(sql).all(...params) as Array<{
      activity_id: string;
      name: string;
      version: number;
      verified: number;
      lifecycle_phase: LifecyclePhase;
    }>;

    return rows.map((r) => ({
      activity_id: r.activity_id,
      name: r.name,
      version: r.version,
      verified: r.verified === 1,
      lifecycle_phase: r.lifecycle_phase,
    }));
  }

  async getLifecyclePhase(activityId: string): Promise<LifecyclePhase> {
    const row = this.db
      .prepare("SELECT phase FROM lifecycle WHERE activity_id = ?")
      .get(activityId) as { phase: LifecyclePhase } | undefined;
    return row?.phase ?? "unresearched";
  }

  async setLifecyclePhase(activityId: string, phase: LifecyclePhase): Promise<void> {
    const txn = this.db.transaction(() => {
      const current = this.db
        .prepare("SELECT phase FROM lifecycle WHERE activity_id = ?")
        .get(activityId) as { phase: string } | undefined;

      const fromPhase = current?.phase ?? null;

      this.db
        .prepare(
          `INSERT INTO lifecycle (activity_id, phase, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(activity_id) DO UPDATE SET phase = ?, updated_at = datetime('now')`
        )
        .run(activityId, phase, phase);

      this.db
        .prepare("INSERT INTO lifecycle_log (activity_id, from_phase, to_phase) VALUES (?, ?, ?)")
        .run(activityId, fromPhase, phase);
    });

    txn();
  }

  async appendTestRecord(activityId: string, record: TestRecord): Promise<void> {
    const map = await this.getMap(activityId);
    if (!map) {
      throw new Error(`No map found for activity ${activityId}`);
    }
    if (!map.test_records) {
      map.test_records = [];
    }
    map.test_records.push(record);
    await this.saveMap(map);
  }

  async appendDriftSignal(activityId: string, signal: DriftSignal): Promise<void> {
    const map = await this.getMap(activityId);
    if (!map) {
      throw new Error(`No map found for activity ${activityId}`);
    }
    if (!map.drift_signals) {
      map.drift_signals = [];
    }
    map.drift_signals.push(signal);
    await this.saveMap(map);
  }

  async getMapHistory(activityId: string, limit?: number): Promise<UIMap[]> {
    let sql = "SELECT map_json FROM maps WHERE activity_id = ? ORDER BY version DESC";
    const params: unknown[] = [activityId];

    if (limit !== undefined) {
      sql += " LIMIT ?";
      params.push(limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{ map_json: string }>;
    return rows.map((r) => JSON.parse(r.map_json) as UIMap);
  }

  close(): void {
    this.db.close();
  }
}
