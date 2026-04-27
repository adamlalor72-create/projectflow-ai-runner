/**
 * Researcher Agent API — Seeds knowledge from web + in-app help.
 * See /docs/cartographer/researcher-policy.md for policy details.
 */

import type { Confidence } from "./types/knowledge.js";

// ── Input ───────────────────────────────────────────────────────

export interface ResearcherInput {
  activity_id: string;
  activity_name?: string;
  scope_item_refs?: string[];
}

// ── Output ──────────────────────────────────────────────────────

export interface ResearcherOutput {
  files_written: string[];
  sources_cited: Array<{
    url: string;
    accessed_at: string;
    confidence: Confidence;
  }>;
  uncertainty_flags: Array<{
    file: string;
    line: number;
    note: string;
  }>;
  overall_confidence: Confidence;
  cost_usd: number;
  duration_ms: number;
}

// ── Error Modes ─────────────────────────────────────────────────

export type ResearcherErrorCode =
  | "insufficient_sources"
  | "allowlist_empty"
  | "matrix_unavailable";

export class ResearcherError extends Error {
  constructor(
    public readonly code: ResearcherErrorCode,
    message: string,
    public readonly partial_output?: Partial<ResearcherOutput>
  ) {
    super(message);
    this.name = "ResearcherError";
  }
}

// ── API ─────────────────────────────────────────────────────────

export interface ResearcherAPI {
  research(input: ResearcherInput): Promise<ResearcherOutput>;
}
