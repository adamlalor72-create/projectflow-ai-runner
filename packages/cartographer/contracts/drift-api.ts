/**
 * Drift Monitor API — Detects UI changes ahead of production failures.
 */

import type { DriftSignal } from "./types/ui-map.js";

export interface DriftCheckResult {
  has_drift: boolean;
  signals: DriftSignal[];
  duration_ms: number;
}

export interface DriftAPI {
  check(activityId: string): Promise<DriftCheckResult>;
  checkAll(): Promise<Array<{ activity_id: string; result: DriftCheckResult }>>;
  getHistory(activityId: string, limit?: number): Promise<DriftSignal[]>;
}
