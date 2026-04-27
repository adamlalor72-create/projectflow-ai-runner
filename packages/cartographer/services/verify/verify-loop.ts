import type { VerifyAPI, VerifyResult } from "../../contracts/verify-api.js";
import type { UIMap, TestRecord } from "../../contracts/types/ui-map.js";
import type { LoadEngineAPI } from "../../contracts/load-engine-api.js";
import type { RepairAPI } from "../../contracts/repair-api.js";
import type { StoreAPI } from "../../contracts/store-api.js";

export interface VerifyLoopOptions {
  loadEngine: LoadEngineAPI;
  repairAgent: RepairAPI;
  store: StoreAPI;
}

export class VerifyLoop implements VerifyAPI {
  private loadEngine: LoadEngineAPI;
  private repairAgent: RepairAPI;
  private store: StoreAPI;

  constructor(options: VerifyLoopOptions) {
    this.loadEngine = options.loadEngine;
    this.repairAgent = options.repairAgent;
    this.store = options.store;
  }

  async verify(
    map: UIMap,
    options?: {
      max_iterations?: number;
      test_data?: Record<string, unknown>;
    }
  ): Promise<VerifyResult> {
    const start = Date.now();
    const maxIterations = options?.max_iterations ?? 3;
    const testData = options?.test_data ?? generateDefaultTestData(map);
    const records: TestRecord[] = [];
    let currentMap = map;
    let totalCost = 0;

    for (let i = 0; i < maxIterations; i++) {
      const loadResult = await this.loadEngine.load(currentMap, testData, {
        screenshot_on_error: true,
      });

      const record: TestRecord = {
        run_id: `verify-${Date.now()}-${i}`,
        passed: loadResult.success,
        timestamp: new Date().toISOString(),
        errors: loadResult.errors.map((e) => `${e.field_id}: ${e.error}`),
        duration_ms: loadResult.duration_ms,
      };
      records.push(record);

      await this.store.appendTestRecord(currentMap.activity_id, record);

      if (loadResult.success) {
        return {
          passed: true,
          iterations: i + 1,
          records,
          final_map: currentMap,
          cost_usd: totalCost,
          duration_ms: Date.now() - start,
        };
      }

      if (i < maxIterations - 1) {
        const firstError = loadResult.errors[0];
        const repairResult = await this.repairAgent.repair(currentMap, {
          error: firstError.error,
          field_id: firstError.field_id,
        });
        totalCost += repairResult.cost_usd;

        if (repairResult.repaired) {
          currentMap = repairResult.map;
          await this.store.saveMap(currentMap);
        }
      }
    }

    return {
      passed: false,
      iterations: maxIterations,
      records,
      final_map: currentMap,
      cost_usd: totalCost,
      duration_ms: Date.now() - start,
    };
  }
}

function generateDefaultTestData(map: UIMap): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of map.fields) {
    switch (field.type) {
      case "text":
      case "textarea":
        data[field.id] = "TEST_VALUE";
        break;
      case "number":
        data[field.id] = 42;
        break;
      case "date":
        data[field.id] = "2026-01-01";
        break;
      case "checkbox":
        data[field.id] = true;
        break;
      case "dropdown":
        if (field.enumeration?.[0]) {
          data[field.id] = field.enumeration[0].value;
        }
        break;
      default:
        data[field.id] = "TEST";
    }
  }
  return data;
}
