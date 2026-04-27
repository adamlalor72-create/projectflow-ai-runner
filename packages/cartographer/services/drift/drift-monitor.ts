import type { DriftAPI, DriftCheckResult } from "../../contracts/drift-api.js";
import type { DriftSignal } from "../../contracts/types/ui-map.js";
import type { PageAdapter } from "../../contracts/types/page-adapter.js";
import type { StoreAPI } from "../../contracts/store-api.js";

export interface DriftMonitorOptions {
  page: PageAdapter;
  store: StoreAPI;
}

export class DriftMonitor implements DriftAPI {
  private page: PageAdapter;
  private store: StoreAPI;

  constructor(options: DriftMonitorOptions) {
    this.page = options.page;
    this.store = options.store;
  }

  async check(activityId: string): Promise<DriftCheckResult> {
    const start = Date.now();
    const map = await this.store.getMap(activityId);

    if (!map) {
      return { has_drift: false, signals: [], duration_ms: Date.now() - start };
    }

    if (map.navigation.deep_link) {
      await this.page.goto(map.navigation.deep_link);
    }

    const signals: DriftSignal[] = [];

    for (const field of map.fields) {
      try {
        const loc = this.page.locator(field.selectors.primary);
        const visible = await loc.isVisible({ timeout: 3000 });
        if (!visible) {
          signals.push({
            detected_at: new Date().toISOString(),
            field_id: field.id,
            signal_type: "selector_miss",
            detail: `Primary selector "${field.selectors.primary}" not visible`,
          });
        }
      } catch {
        signals.push({
          detected_at: new Date().toISOString(),
          field_id: field.id,
          signal_type: "selector_miss",
          detail: `Primary selector "${field.selectors.primary}" threw error`,
        });
      }
    }

    for (const signal of signals) {
      await this.store.appendDriftSignal(activityId, signal);
    }

    if (signals.length > 0) {
      await this.store.setLifecyclePhase(activityId, "drifted");
    }

    return {
      has_drift: signals.length > 0,
      signals,
      duration_ms: Date.now() - start,
    };
  }

  async checkAll(): Promise<Array<{ activity_id: string; result: DriftCheckResult }>> {
    const activities = await this.store.listActivities({
      lifecycle_phase: "verified",
    });
    const productionActivities = await this.store.listActivities({
      lifecycle_phase: "production",
    });

    const allActivities = [...activities, ...productionActivities];
    const results: Array<{ activity_id: string; result: DriftCheckResult }> = [];

    for (const activity of allActivities) {
      const result = await this.check(activity.activity_id);
      results.push({ activity_id: activity.activity_id, result });
    }

    return results;
  }

  async getHistory(activityId: string, limit?: number): Promise<DriftSignal[]> {
    const map = await this.store.getMap(activityId);
    if (!map?.drift_signals) return [];
    const signals = [...map.drift_signals].reverse();
    return limit ? signals.slice(0, limit) : signals;
  }
}
