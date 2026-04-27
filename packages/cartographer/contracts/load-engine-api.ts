/**
 * Load Engine API — Deterministic Playwright execution, no LLM.
 * Reads a verified UI Map and executes field-by-field data entry.
 */

import type { UIMap } from "./types/ui-map.js";

export interface LoadResult {
  success: boolean;
  fields_set: number;
  fields_skipped: number;
  errors: Array<{
    field_id: string;
    error: string;
    selector_used: string;
  }>;
  screenshots: string[];
  duration_ms: number;
}

export interface LoadEngineAPI {
  load(
    map: UIMap,
    data: Record<string, unknown>,
    options?: { dry_run?: boolean; screenshot_on_error?: boolean }
  ): Promise<LoadResult>;

  bulkLoad(
    items: Array<{ map: UIMap; data: Record<string, unknown> }>,
    options?: { stop_on_error?: boolean; dry_run?: boolean }
  ): Promise<LoadResult[]>;
}
