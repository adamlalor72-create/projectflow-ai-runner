import { describe, it, expect } from "vitest";
import { RepairAgent } from "../services/repair/index.js";
import { createMockPage } from "./helpers/mock-page.js";
import { createMockLLM } from "./helpers/mock-llm.js";
import { makeMinimalMap } from "./helpers/fixtures.js";

describe("RepairAgent", () => {
  it("repairs a broken selector", async () => {
    const page = createMockPage();
    const llm = createMockLLM([
      JSON.stringify({ selector: "#ptKey-fixed", change_type: "selector_updated" }),
    ]);

    const agent = new RepairAgent({ page, llm });
    const map = makeMinimalMap();

    const result = await agent.repair(map, {
      error: "Selector not found",
      field_id: "f1",
    });

    expect(result.repaired).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].field_id).toBe("f1");
    expect(result.changes[0].old_value).toBe("#ptKey");
    expect(result.changes[0].new_value).toBe("#ptKey-fixed");
    expect(result.map.fields[0].selectors.primary).toBe("#ptKey-fixed");
  });

  it("does not modify original map", async () => {
    const page = createMockPage();
    const llm = createMockLLM([
      JSON.stringify({ selector: "#new-selector" }),
    ]);

    const agent = new RepairAgent({ page, llm });
    const map = makeMinimalMap();

    await agent.repair(map, { error: "broken", field_id: "f1" });

    expect(map.fields[0].selectors.primary).toBe("#ptKey");
  });

  it("handles unparseable LLM response", async () => {
    const page = createMockPage();
    const llm = createMockLLM(["not json"]);

    const agent = new RepairAgent({ page, llm });
    const map = makeMinimalMap();

    const result = await agent.repair(map, { error: "broken", field_id: "f1" });

    expect(result.repaired).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  it("reports cost", async () => {
    const page = createMockPage();
    const llm = createMockLLM([JSON.stringify({ selector: "#fix" })]);

    const agent = new RepairAgent({ page, llm });
    const result = await agent.repair(makeMinimalMap(), { error: "err", field_id: "f1" });

    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
