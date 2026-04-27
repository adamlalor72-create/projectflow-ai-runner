/**
 * Verify Loop API — Tests a UI Map with synthetic data, iterates on failures.
 */

import type { UIMap, TestRecord } from "./types/ui-map.js";

export interface VerifyResult {
  passed: boolean;
  iterations: number;
  records: TestRecord[];
  final_map: UIMap;
  cost_usd: number;
  duration_ms: number;
}

export interface VerifyAPI {
  verify(
    map: UIMap,
    options?: {
      max_iterations?: number;
      test_data?: Record<string, unknown>;
    }
  ): Promise<VerifyResult>;
}
