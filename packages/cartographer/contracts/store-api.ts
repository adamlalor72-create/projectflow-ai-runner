/**
 * Store API — Map Store contract
 * Postgres + JSON schema, source of truth for UI Maps and activity state.
 */

import type { UIMap, TestRecord, DriftSignal } from "./types/ui-map.js";
import type { LifecyclePhase } from "./mcp-tools.js";

export interface StoreAPI {
  getMap(activityId: string): Promise<UIMap | null>;
  saveMap(map: UIMap): Promise<void>;
  listActivities(filter?: {
    verified?: boolean;
    lifecycle_phase?: LifecyclePhase;
  }): Promise<Array<{ activity_id: string; name: string; version: number; verified: boolean; lifecycle_phase: LifecyclePhase }>>;
  getLifecyclePhase(activityId: string): Promise<LifecyclePhase>;
  setLifecyclePhase(activityId: string, phase: LifecyclePhase): Promise<void>;
  appendTestRecord(activityId: string, record: TestRecord): Promise<void>;
  appendDriftSignal(activityId: string, signal: DriftSignal): Promise<void>;
  getMapHistory(activityId: string, limit?: number): Promise<UIMap[]>;
}
