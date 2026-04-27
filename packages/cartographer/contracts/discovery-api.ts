/**
 * Discovery Agent API — Walks the UI, produces a candidate UI Map.
 */

import type { UIMap } from "./types/ui-map.js";

export interface DiscoveryResult {
  map: UIMap;
  is_new: boolean;
  fields_found: number;
  screenshots_taken: number;
  cost_usd: number;
  duration_ms: number;
}

export interface DiscoveryAPI {
  discover(
    activityId: string,
    options?: {
      activity_name?: string;
      force?: boolean;
      existing_map?: UIMap;
    }
  ): Promise<DiscoveryResult>;
}
