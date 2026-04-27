import Database from "better-sqlite3";
import type { LibrarianAPI, SourceScore } from "../../contracts/librarian-api.js";
import type { Confidence } from "../../contracts/types/knowledge.js";
import type { StoreAPI } from "../../contracts/store-api.js";
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_ROOT = path.resolve(__dirname, "../../knowledge");

export interface LibrarianOptions {
  store: StoreAPI;
  dbPath?: string;
  knowledgeRoot?: string;
}

export class Librarian implements LibrarianAPI {
  private db: Database.Database;
  private store: StoreAPI;
  private knowledgeRoot: string;

  constructor(options: LibrarianOptions) {
    this.store = options.store;
    this.knowledgeRoot = options.knowledgeRoot ?? KNOWLEDGE_ROOT;
    this.db = new Database(options.dbPath ?? ":memory:");
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_scores (
        url          TEXT PRIMARY KEY,
        accuracy     REAL NOT NULL DEFAULT 1.0,
        citations    INTEGER NOT NULL DEFAULT 0,
        last_verified TEXT,
        demoted      INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async updateSourceScore(url: string, survived_verify: boolean): Promise<SourceScore> {
    const existing = this.db
      .prepare("SELECT * FROM source_scores WHERE url = ?")
      .get(url) as SourceScoreRow | undefined;

    const currentAccuracy = existing?.accuracy ?? 1.0;
    const currentCitations = existing?.citations ?? 0;
    const delta = survived_verify ? 0.1 : -0.2;
    const newAccuracy = Math.max(0, Math.min(2, currentAccuracy + delta));
    const demoted = newAccuracy < 0.5 ? 1 : 0;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO source_scores (url, accuracy, citations, last_verified, demoted)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           accuracy = ?, citations = citations + 1, last_verified = ?, demoted = ?`
      )
      .run(url, newAccuracy, currentCitations + 1, now, demoted, newAccuracy, now, demoted);

    const row = this.db
      .prepare("SELECT * FROM source_scores WHERE url = ?")
      .get(url) as SourceScoreRow;

    return rowToScore(row);
  }

  async getSourceScores(): Promise<SourceScore[]> {
    const rows = this.db
      .prepare("SELECT * FROM source_scores ORDER BY accuracy DESC")
      .all() as SourceScoreRow[];
    return rows.map(rowToScore);
  }

  async getDemotedSources(): Promise<SourceScore[]> {
    const rows = this.db
      .prepare("SELECT * FROM source_scores WHERE demoted = 1 ORDER BY accuracy ASC")
      .all() as SourceScoreRow[];
    return rows.map(rowToScore);
  }

  async promotePattern(pattern: {
    category: string;
    pattern: string;
    description: string;
    source_activity_id: string;
  }): Promise<void> {
    const targetFile = path.join(
      this.knowledgeRoot,
      "general",
      `${pattern.category.replace(/\s+/g, "_")}.md`
    );

    const entry = `\n\n## ${pattern.pattern}\n\n${pattern.description}\n\n_Source: Activity ${pattern.source_activity_id}_\n`;
    appendFileSync(targetFile, entry);
  }

  async rebuildIndex(): Promise<{ files_indexed: number; activities_indexed: number }> {
    let filesIndexed = 0;
    const activitiesSet = new Set<string>();

    const lines: string[] = ["# Knowledge Base Index\n"];

    const activitiesDir = path.join(this.knowledgeRoot, "activities");
    try {
      const activityDirs = readdirSync(activitiesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      if (activityDirs.length > 0) {
        lines.push("## Activities\n");
      }

      for (const dir of activityDirs) {
        const activityId = dir.split("_")[0];
        activitiesSet.add(activityId);
        const files = readdirSync(path.join(activitiesDir, dir))
          .filter((f) => f.endsWith(".md"));

        for (const file of files) {
          lines.push(`- [${dir}/${file}](activities/${dir}/${file})`);
          filesIndexed++;
        }
      }
    } catch {
      // activities dir may not exist
    }

    const generalDir = path.join(this.knowledgeRoot, "general");
    try {
      const generalFiles = readdirSync(generalDir).filter((f) => f.endsWith(".md"));
      if (generalFiles.length > 0) {
        lines.push("\n## General Knowledge\n");
      }
      for (const file of generalFiles) {
        lines.push(`- [${file}](general/${file})`);
        filesIndexed++;
      }
    } catch {
      // general dir may not exist
    }

    writeFileSync(path.join(this.knowledgeRoot, "INDEX.md"), lines.join("\n") + "\n");

    return {
      files_indexed: filesIndexed,
      activities_indexed: activitiesSet.size,
    };
  }

  async assessConfidence(activityId: string): Promise<Confidence> {
    const map = await this.store.getMap(activityId);
    if (!map) return "low";

    const testRecords = map.test_records ?? [];
    const driftSignals = map.drift_signals ?? [];

    if (driftSignals.length > 0) return "low";
    if (testRecords.length === 0) return "low";

    const recentRecords = testRecords.slice(-3);
    const allPassed = recentRecords.every((r) => r.passed);
    if (allPassed && recentRecords.length >= 3) return "high";
    if (allPassed) return "medium";
    return "low";
  }

  close(): void {
    this.db.close();
  }
}

interface SourceScoreRow {
  url: string;
  accuracy: number;
  citations: number;
  last_verified: string | null;
  demoted: number;
}

function rowToScore(row: SourceScoreRow): SourceScore {
  return {
    url: row.url,
    accuracy: row.accuracy,
    citations: row.citations,
    last_verified: row.last_verified ?? "",
    demoted: row.demoted === 1,
  };
}
