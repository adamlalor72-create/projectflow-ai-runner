import type { RepairAPI, RepairResult } from "../../contracts/repair-api.js";
import type { UIMap } from "../../contracts/types/ui-map.js";
import type { PageAdapter } from "../../contracts/types/page-adapter.js";
import type { LLMClient } from "../../contracts/types/llm-client.js";
import { logCost } from "../telemetry/cost-logger.js";

export interface RepairAgentOptions {
  page: PageAdapter;
  llm: LLMClient;
}

export class RepairAgent implements RepairAPI {
  private page: PageAdapter;
  private llm: LLMClient;

  constructor(options: RepairAgentOptions) {
    this.page = options.page;
    this.llm = options.llm;
  }

  async repair(
    map: UIMap,
    failure: { error: string; field_id?: string; screenshot?: string }
  ): Promise<RepairResult> {
    const start = Date.now();

    const screenshot = await this.page.screenshot();
    const screenshotB64 = screenshot.toString("base64");

    const failedField = failure.field_id
      ? map.fields.find((f) => f.id === failure.field_id)
      : null;

    const response = await this.llm.complete([
      {
        role: "system",
        content: `You are an SAP UI5 repair expert. A field load failed. Analyze the screenshot and suggest a corrected CSS selector. Return JSON: { "selector": "new-css-selector", "change_type": "selector_updated" }`,
      },
      {
        role: "user",
        content: `Error: ${failure.error}\nField: ${JSON.stringify(failedField)}\nScreenshot: ${screenshotB64.slice(0, 100)}...`,
      },
    ]);

    const cost = estimateCost(response.input_tokens, response.output_tokens);

    const changes: RepairResult["changes"] = [];
    const repairedMap = structuredClone(map);
    let repaired = false;

    try {
      const parsed = JSON.parse(extractJson(response.content));
      if (parsed.selector && failure.field_id) {
        const fieldIdx = repairedMap.fields.findIndex((f) => f.id === failure.field_id);
        if (fieldIdx !== -1) {
          const oldSelector = repairedMap.fields[fieldIdx].selectors.primary;
          repairedMap.fields[fieldIdx].selectors.primary = parsed.selector;
          changes.push({
            field_id: failure.field_id,
            change_type: (parsed.change_type as RepairResult["changes"][0]["change_type"]) ?? "selector_updated",
            old_value: oldSelector,
            new_value: parsed.selector,
          });
          repaired = true;
        }
      }
    } catch {
      // LLM response not parseable — no repair made
    }

    logCost({
      agent_name: "repair",
      activity_id: map.activity_id,
      phase: "repair",
      model: response.model,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      cost_usd: cost,
    });

    return {
      repaired,
      changes,
      map: repairedMap,
      cost_usd: cost,
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
