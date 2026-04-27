/**
 * Repair Agent API — Patches the UI Map and knowledge on load/verify failure.
 */

import type { UIMap } from "./types/ui-map.js";

export interface RepairResult {
  repaired: boolean;
  changes: Array<{
    field_id: string;
    change_type: "selector_updated" | "field_added" | "field_removed" | "type_changed";
    old_value: string;
    new_value: string;
  }>;
  map: UIMap;
  cost_usd: number;
  duration_ms: number;
}

export interface RepairAPI {
  repair(
    map: UIMap,
    failure: {
      error: string;
      field_id?: string;
      screenshot?: string;
    }
  ): Promise<RepairResult>;
}
