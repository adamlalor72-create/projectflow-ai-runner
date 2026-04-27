/**
 * CBC Cartographer — MCP Tool Definitions
 * Input and output types for each MCP-exposed tool.
 */

import type { UIMap, DriftSignal } from "./types/ui-map.js";
import type { Confidence, KnowledgeFrontmatter } from "./types/knowledge.js";

// ── Common ──────────────────────────────────────────────────────

export interface ActivitySummary {
  activity_id: string;
  name: string;
  verified: boolean;
  verified_at: string | null;
  version: number;
  lifecycle_phase: LifecyclePhase;
}

export type LifecyclePhase =
  | "unresearched"
  | "researched"
  | "discovered"
  | "verified"
  | "production"
  | "drifted"
  | "failed";

// ── list_activities ─────────────────────────────────────────────

export interface ListActivitiesInput {
  filter?: {
    verified?: boolean;
    lifecycle_phase?: LifecyclePhase;
  };
  limit?: number;
  offset?: number;
}

export interface ListActivitiesOutput {
  activities: ActivitySummary[];
  total: number;
}

// ── describe_activity ───────────────────────────────────────────

export interface DescribeActivityInput {
  activity_id: string;
}

export interface DescribeActivityOutput {
  map: UIMap;
  knowledge: KnowledgeFrontmatter | null;
  lifecycle_phase: LifecyclePhase;
}

// ── load_activity ───────────────────────────────────────────────

export interface LoadActivityInput {
  activity_id: string;
  data: Record<string, unknown>;
  dry_run?: boolean;
}

export interface LoadActivityOutput {
  success: boolean;
  fields_set: number;
  errors: string[];
  screenshots: string[];
  duration_ms: number;
}

// ── bulk_load ───────────────────────────────────────────────────

export interface BulkLoadInput {
  items: Array<{
    activity_id: string;
    data: Record<string, unknown>;
  }>;
  dry_run?: boolean;
  stop_on_error?: boolean;
}

export interface BulkLoadOutput {
  results: Array<{
    activity_id: string;
    success: boolean;
    errors: string[];
    duration_ms: number;
  }>;
  total_duration_ms: number;
}

// ── discover_activity ───────────────────────────────────────────

export interface DiscoverActivityInput {
  activity_id: string;
  activity_name?: string;
  force?: boolean;
}

export interface DiscoverActivityOutput {
  map: UIMap;
  is_new: boolean;
  fields_found: number;
  cost_usd: number;
  duration_ms: number;
}

// ── verify_activity ─────────────────────────────────────────────

export interface VerifyActivityInput {
  activity_id: string;
  max_iterations?: number;
}

export interface VerifyActivityOutput {
  passed: boolean;
  iterations: number;
  failures: string[];
  map_version: number;
  cost_usd: number;
  duration_ms: number;
}

// ── diff_activity ───────────────────────────────────────────────

export interface DiffActivityInput {
  activity_id: string;
}

export interface DiffActivityOutput {
  has_drift: boolean;
  signals: DriftSignal[];
  last_verified_at: string | null;
  current_version: number;
}

// ── research_activity ───────────────────────────────────────────

export interface ResearchActivityInput {
  activity_id: string;
  activity_name?: string;
  scope_item_refs?: string[];
}

export interface ResearchActivityOutput {
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

// ── get_activity_knowledge ──────────────────────────────────────

export interface GetActivityKnowledgeInput {
  activity_id: string;
}

export interface GetActivityKnowledgeOutput {
  files: Array<{
    path: string;
    frontmatter: KnowledgeFrontmatter;
    content: string;
  }>;
}

// ── search_knowledge ────────────────────────────────────────────

export interface SearchKnowledgeInput {
  query: string;
  scope?: "activities" | "general" | "all";
  limit?: number;
}

export interface SearchKnowledgeOutput {
  results: Array<{
    path: string;
    activity_id: string | null;
    snippet: string;
    relevance: number;
  }>;
}

// ── get_failure_patterns ────────────────────────────────────────

export interface GetFailurePatternsInput {
  activity_id?: string;
  limit?: number;
}

export interface GetFailurePatternsOutput {
  patterns: Array<{
    pattern: string;
    occurrences: number;
    last_seen: string;
    affected_activities: string[];
    resolution: string | null;
  }>;
}

// ── get_general_patterns ────────────────────────────────────────

export interface GetGeneralPatternsInput {
  category?: string;
  limit?: number;
}

export interface GetGeneralPatternsOutput {
  patterns: Array<{
    category: string;
    pattern: string;
    description: string;
    source: string;
  }>;
}
