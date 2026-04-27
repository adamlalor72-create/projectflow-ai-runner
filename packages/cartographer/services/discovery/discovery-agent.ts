import type { DiscoveryAPI, DiscoveryResult } from "../../contracts/discovery-api.js";
import type { UIMap, Field } from "../../contracts/types/ui-map.js";
import type { PageAdapter } from "../../contracts/types/page-adapter.js";
import type { LLMClient } from "../../contracts/types/llm-client.js";
import type { StoreAPI } from "../../contracts/store-api.js";
import { logCost } from "../telemetry/cost-logger.js";

export interface DiscoveryAgentOptions {
  page: PageAdapter;
  llm: LLMClient;
  store: StoreAPI;
}

export class DiscoveryAgent implements DiscoveryAPI {
  private page: PageAdapter;
  private llm: LLMClient;
  private store: StoreAPI;

  constructor(options: DiscoveryAgentOptions) {
    this.page = options.page;
    this.llm = options.llm;
    this.store = options.store;
  }

  async discover(
    activityId: string,
    options?: {
      activity_name?: string;
      force?: boolean;
      existing_map?: UIMap;
    }
  ): Promise<DiscoveryResult> {
    const start = Date.now();
    let totalCost = 0;

    const existingMap = options?.existing_map ?? await this.store.getMap(activityId);
    if (existingMap && !options?.force) {
      return {
        map: existingMap,
        is_new: false,
        fields_found: existingMap.fields.length,
        screenshots_taken: 0,
        cost_usd: 0,
        duration_ms: Date.now() - start,
      };
    }

    const activityName = options?.activity_name ?? `Activity ${activityId}`;

    const screenshot = await this.page.screenshot();
    const screenshotB64 = screenshot.toString("base64");

    const response = await this.llm.complete([
      {
        role: "system",
        content: `You are an SAP UI5 expert. Analyze the screenshot of CBC activity "${activityName}" (ID: ${activityId}). Identify all visible form fields, their types, labels, and generate CSS selectors. Return a JSON object with: { fields: [{ id, label, type, required, selectors: { primary } }], navigation: { path: string[] }, actions: { save: { selectors: { primary } }, cancel: { selectors: { primary } } } }`,
      },
      {
        role: "user",
        content: `Screenshot (base64): ${screenshotB64.slice(0, 100)}...`,
      },
    ]);

    const cost = estimateCost(response.input_tokens, response.output_tokens);
    totalCost += cost;

    let parsedFields: Field[];
    let navigationPath: string[];
    try {
      const parsed = JSON.parse(extractJson(response.content));
      parsedFields = (parsed.fields ?? []).map((f: any, idx: number) => ({
        id: f.id ?? `field_${idx}`,
        label: f.label ?? `Field ${idx}`,
        type: f.type ?? "text",
        required: f.required ?? false,
        selectors: { primary: f.selectors?.primary ?? `#field_${idx}` },
      }));
      navigationPath = parsed.navigation?.path ?? ["Home", activityName];
    } catch {
      parsedFields = [];
      navigationPath = ["Home", activityName];
    }

    const map: UIMap = {
      activity_id: activityId,
      name: activityName,
      version: 1,
      verified: false,
      verified_at: null,
      navigation: { path: navigationPath },
      fields: parsedFields,
      actions: {
        save: { selectors: { primary: "button[data-action='save']" } },
        cancel: { selectors: { primary: "button[data-action='cancel']" } },
      },
      discovery_trace: {
        agent_version: "0.1.0",
        discovered_at: new Date().toISOString(),
        duration_ms: Date.now() - start,
        screenshot_count: 1,
      },
    };

    await this.store.saveMap(map);

    logCost({
      agent_name: "discovery",
      activity_id: activityId,
      phase: "discovery",
      model: response.model,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      cost_usd: totalCost,
    });

    return {
      map,
      is_new: true,
      fields_found: parsedFields.length,
      screenshots_taken: 1,
      cost_usd: totalCost,
      duration_ms: Date.now() - start,
    };
  }
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "{}";
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}
