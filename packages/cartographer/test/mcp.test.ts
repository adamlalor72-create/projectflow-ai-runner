import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPServer } from "../services/mcp/index.js";
import { MapStore } from "../services/store/index.js";
import { Orchestrator } from "../services/orchestrator/index.js";
import { LoadEngine } from "../services/load-engine/index.js";
import { DriftMonitor } from "../services/drift/index.js";
import { createMockPage, createMockLocator } from "./helpers/mock-page.js";
import { makeMinimalMap } from "./helpers/fixtures.js";

let store: MapStore;
let orch: Orchestrator;
let server: MCPServer;

beforeEach(() => {
  store = new MapStore();
  orch = new Orchestrator(store);
});

afterEach(() => {
  orch.close();
  store.close();
});

describe("MCPServer", () => {
  describe("listActivities", () => {
    it("returns empty list when no activities", async () => {
      server = new MCPServer({ store, orchestrator: orch });
      const result = await server.listActivities({});
      expect(result.activities).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("lists stored activities", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "100" }));
      await store.saveMap(makeMinimalMap({ activity_id: "200" }));

      server = new MCPServer({ store, orchestrator: orch });
      const result = await server.listActivities({});
      expect(result.activities).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("supports pagination", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "100" }));
      await store.saveMap(makeMinimalMap({ activity_id: "200" }));
      await store.saveMap(makeMinimalMap({ activity_id: "300" }));

      server = new MCPServer({ store, orchestrator: orch });
      const result = await server.listActivities({ limit: 2, offset: 0 });
      expect(result.activities).toHaveLength(2);
      expect(result.total).toBe(3);
    });
  });

  describe("describeActivity", () => {
    it("returns map and lifecycle phase", async () => {
      await store.saveMap(makeMinimalMap());
      await store.setLifecyclePhase("102934", "discovered");

      server = new MCPServer({ store, orchestrator: orch });
      const result = await server.describeActivity({ activity_id: "102934" });

      expect(result.map.activity_id).toBe("102934");
      expect(result.lifecycle_phase).toBe("discovered");
    });

    it("throws for nonexistent activity", async () => {
      server = new MCPServer({ store, orchestrator: orch });
      await expect(
        server.describeActivity({ activity_id: "missing" })
      ).rejects.toThrow("not found");
    });
  });

  describe("loadActivity", () => {
    it("loads data into an activity", async () => {
      await store.saveMap(makeMinimalMap());
      const page = createMockPage();
      const loadEngine = new LoadEngine(page);

      server = new MCPServer({ store, orchestrator: orch, loadEngine });
      const result = await server.loadActivity({
        activity_id: "102934",
        data: { f1: "value" },
      });

      expect(result.success).toBe(true);
      expect(result.fields_set).toBe(1);
    });

    it("throws when Load Engine not available", async () => {
      server = new MCPServer({ store, orchestrator: orch });
      await expect(
        server.loadActivity({ activity_id: "102934", data: {} })
      ).rejects.toThrow("Load Engine not available");
    });
  });

  describe("bulkLoad", () => {
    it("loads multiple activities", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "100" }));
      await store.saveMap(makeMinimalMap({ activity_id: "200" }));
      const page = createMockPage();
      const loadEngine = new LoadEngine(page);

      server = new MCPServer({ store, orchestrator: orch, loadEngine });
      const result = await server.bulkLoad({
        items: [
          { activity_id: "100", data: {} },
          { activity_id: "200", data: {} },
        ],
      });

      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
    });

    it("handles missing activity", async () => {
      const page = createMockPage();
      const loadEngine = new LoadEngine(page);

      server = new MCPServer({ store, orchestrator: orch, loadEngine });
      const result = await server.bulkLoad({
        items: [{ activity_id: "nonexistent", data: {} }],
      });

      expect(result.results[0].success).toBe(false);
      expect(result.results[0].errors[0]).toContain("not found");
    });
  });

  describe("diffActivity", () => {
    it("checks drift for an activity", async () => {
      await store.saveMap(makeMinimalMap());
      const page = createMockPage();
      const drift = new DriftMonitor({ page, store });

      server = new MCPServer({ store, orchestrator: orch, drift });
      const result = await server.diffActivity({ activity_id: "102934" });

      expect(result.has_drift).toBe(false);
      expect(result.current_version).toBe(1);
    });

    it("detects drift when selector breaks", async () => {
      await store.saveMap(makeMinimalMap());
      const brokenLocator = createMockLocator({ visible: false });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const drift = new DriftMonitor({ page, store });

      server = new MCPServer({ store, orchestrator: orch, drift });
      const result = await server.diffActivity({ activity_id: "102934" });

      expect(result.has_drift).toBe(true);
      expect(result.signals).toHaveLength(1);
    });
  });

  describe("getToolDefinitions", () => {
    it("returns all 12 tool definitions", () => {
      server = new MCPServer({ store, orchestrator: orch });
      const tools = server.getToolDefinitions();
      expect(tools).toHaveLength(12);
      expect(tools.map((t) => t.name)).toContain("list_activities");
      expect(tools.map((t) => t.name)).toContain("research_activity");
    });
  });
});
