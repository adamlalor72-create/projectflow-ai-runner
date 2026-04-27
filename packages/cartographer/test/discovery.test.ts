import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DiscoveryAgent } from "../services/discovery/index.js";
import { MapStore } from "../services/store/index.js";
import { createMockPage } from "./helpers/mock-page.js";
import { createMockLLM } from "./helpers/mock-llm.js";
import { makeMinimalMap } from "./helpers/fixtures.js";

let store: MapStore;

beforeEach(() => {
  store = new MapStore();
});

afterEach(() => {
  store.close();
});

describe("DiscoveryAgent", () => {
  it("returns existing map without force", async () => {
    const map = makeMinimalMap();
    await store.saveMap(map);

    const page = createMockPage();
    const llm = createMockLLM();
    const agent = new DiscoveryAgent({ page, llm, store });

    const result = await agent.discover("102934");
    expect(result.is_new).toBe(false);
    expect(result.screenshots_taken).toBe(0);
    expect(result.cost_usd).toBe(0);
    expect(llm.callCount).toBe(0);
  });

  it("discovers new map when no existing map", async () => {
    const page = createMockPage();
    const llm = createMockLLM([
      JSON.stringify({
        fields: [
          { id: "f1", label: "Amount", type: "number", selectors: { primary: "#amount" } },
          { id: "f2", label: "Date", type: "date", selectors: { primary: "#date" } },
        ],
        navigation: { path: ["Home", "Finance"] },
      }),
    ]);

    const agent = new DiscoveryAgent({ page, llm, store });
    const result = await agent.discover("99999", { activity_name: "New Activity" });

    expect(result.is_new).toBe(true);
    expect(result.fields_found).toBe(2);
    expect(result.screenshots_taken).toBe(1);
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.map.activity_id).toBe("99999");
    expect(result.map.fields).toHaveLength(2);
  });

  it("discovers with force even when map exists", async () => {
    await store.saveMap(makeMinimalMap());

    const page = createMockPage();
    const llm = createMockLLM([
      JSON.stringify({
        fields: [{ id: "f1", label: "Updated", type: "text", selectors: { primary: "#new" } }],
      }),
    ]);

    const agent = new DiscoveryAgent({ page, llm, store });
    const result = await agent.discover("102934", { force: true });

    expect(result.is_new).toBe(true);
    expect(llm.callCount).toBe(1);
  });

  it("handles unparseable LLM response gracefully", async () => {
    const page = createMockPage();
    const llm = createMockLLM(["not json at all"]);

    const agent = new DiscoveryAgent({ page, llm, store });
    const result = await agent.discover("99999", { activity_name: "Test" });

    expect(result.is_new).toBe(true);
    expect(result.fields_found).toBe(0);
    expect(result.map.fields).toHaveLength(0);
  });

  it("saves discovered map to store", async () => {
    const page = createMockPage();
    const llm = createMockLLM([
      JSON.stringify({
        fields: [{ id: "f1", label: "Field", type: "text", selectors: { primary: "#f" } }],
      }),
    ]);

    const agent = new DiscoveryAgent({ page, llm, store });
    await agent.discover("99999", { activity_name: "Test" });

    const saved = await store.getMap("99999");
    expect(saved).not.toBeNull();
    expect(saved!.fields).toHaveLength(1);
  });
});
