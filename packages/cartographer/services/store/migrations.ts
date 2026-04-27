import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id TEXT    NOT NULL,
      version     INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      verified    INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      map_json    TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(activity_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_maps_activity
      ON maps(activity_id);
    CREATE INDEX IF NOT EXISTS idx_maps_activity_version
      ON maps(activity_id, version DESC);

    CREATE TABLE IF NOT EXISTS lifecycle (
      activity_id TEXT PRIMARY KEY,
      phase       TEXT NOT NULL DEFAULT 'unresearched',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lifecycle_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id TEXT    NOT NULL,
      from_phase  TEXT,
      to_phase    TEXT    NOT NULL,
      changed_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
