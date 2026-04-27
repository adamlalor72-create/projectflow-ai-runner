/**
 * Librarian Agent API — Curates the knowledge base, promotes patterns.
 */

import type { Confidence } from "./types/knowledge.js";

export interface SourceScore {
  url: string;
  accuracy: number;
  citations: number;
  last_verified: string;
  demoted: boolean;
}

export interface LibrarianAPI {
  updateSourceScore(url: string, survived_verify: boolean): Promise<SourceScore>;
  getSourceScores(): Promise<SourceScore[]>;
  getDemotedSources(): Promise<SourceScore[]>;
  promotePattern(pattern: {
    category: string;
    pattern: string;
    description: string;
    source_activity_id: string;
  }): Promise<void>;
  rebuildIndex(): Promise<{ files_indexed: number; activities_indexed: number }>;
  assessConfidence(activityId: string): Promise<Confidence>;
}
