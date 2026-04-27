import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VerifyLoop } from "../services/verify/index.js";
import { MapStore } from "../services/store/index.js";
import { LoadEngine } from "../services/load-engine/index.js";
import { RepairAgent } from "../services/repair/index.js";
import { createMockPage, createMockLocator } from "./helpers/mock-page.js";
import { createMockLLM } from "./helpers/mock-llm.js";
import { makeMinimalMap } from "./helpers/fixtures.js";

let store: MapStore;

beforeEach(() => {
  store = new MapStore();
});

afterEach(() => {
  store.close();
});

describe("VerifyLoop", () => {
  it("passes on first iteration when load succeeds", async () => {
    const map = makeMinimalMap();
    await store.saveMap(map);

    const page = createMockPage();
    const loadEngine = new LoadEngine(page);
    const repairLLM = createMockLLM();
    const repairAgent = new RepairAgent({ page, llm: repairLLM });

    const loop = new VerifyLoop({ loadEngine, repairAgent, store });
    const result = await loop.verify(map, { test_data: {} });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].passed).toBe(true);
  });

  it("retries on failure and calls repair", async () => {
    const map = makeMinimalMap();
    await store.saveMap(map);

    const brokenLocator = createMockLocator({ throwOnWaitFor: true });
    const page = createMockPage({ "#ptKey": brokenLocator });
    const loadEngine = new LoadEngine(page);

    const repairLLM = createMockLLM([
      JSON.stringify({ selector: "#ptKey-fixed", change_type: "selector_updated" }),
    ]);
    const repairAgent = new RepairAgent({ page, llm: repairLLM });

    const loop = new VerifyLoop({ loadEngine, repairAgent, store });
    const result = await loop.verify(map, {
      max_iterations: 2,
      test_data: { f1: "val" },
    });

    expect(result.iterations).toBe(2);
    expect(result.records.length).toBe(2);
  });

  it("returns failed after max iterations", async () => {
    const map = makeMinimalMap();
    await store.saveMap(map);

    const brokenLocator = createMockLocator({ throwOnWaitFor: true });
    const page = createMockPage({
      "#ptKey": brokenLocator,
      "#still-broken": brokenLocator,
      "#still-broken-2": brokenLocator,
    });
    const loadEngine = new LoadEngine(page);

    const repairLLM = createMockLLM([
      JSON.stringify({ selector: "#still-broken" }),
      JSON.stringify({ selector: "#still-broken-2" }),
    ]);
    const repairAgent = new RepairAgent({ page, llm: repairLLM });

    const loop = new VerifyLoop({ loadEngine, repairAgent, store });
    const result = await loop.verify(map, {
      max_iterations: 3,
      test_data: { f1: "val" },
    });

    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.records).toHaveLength(3);
  });

  it("appends test records to store", async () => {
    const map = makeMinimalMap();
    await store.saveMap(map);

    const page = createMockPage();
    const loadEngine = new LoadEngine(page);
    const repairAgent = new RepairAgent({ page, llm: createMockLLM() });

    const loop = new VerifyLoop({ loadEngine, repairAgent, store });
    await loop.verify(map, { test_data: {} });

    const updated = await store.getMap("102934");
    expect(updated!.test_records).toBeDefined();
    expect(updated!.test_records!.length).toBeGreaterThan(0);
  });
});
