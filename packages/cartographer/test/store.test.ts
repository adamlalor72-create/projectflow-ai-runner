import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MapStore } from "../services/store/index.js";
import { makeMinimalMap, makeFullMap, makeTestRecord, makeDriftSignal } from "./helpers/fixtures.js";

let store: MapStore;

beforeEach(() => {
  store = new MapStore();
});

afterEach(() => {
  store.close();
});

describe("MapStore", () => {
  describe("saveMap + getMap", () => {
    it("round-trips a valid map", async () => {
      const map = makeMinimalMap();
      await store.saveMap(map);
      const retrieved = await store.getMap("102934");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.activity_id).toBe("102934");
      expect(retrieved!.name).toBe("Maintain Terms of Payment");
      expect(retrieved!.version).toBe(1);
      expect(retrieved!.fields).toHaveLength(1);
    });

    it("auto-increments version on successive saves", async () => {
      const map = makeMinimalMap();
      await store.saveMap(map);
      await store.saveMap(map);
      await store.saveMap(map);

      const latest = await store.getMap("102934");
      expect(latest!.version).toBe(3);

      const history = await store.getMapHistory("102934");
      expect(history.map((m) => m.version)).toEqual([3, 2, 1]);
    });

    it("rejects an invalid map", async () => {
      const bad = { activity_id: "x" } as any;
      await expect(store.saveMap(bad)).rejects.toThrow("UIMap validation failed");
    });

    it("returns null for nonexistent activity", async () => {
      const result = await store.getMap("nonexistent");
      expect(result).toBeNull();
    });

    it("stores a fully populated map", async () => {
      const full = makeFullMap();
      await store.saveMap(full);
      const retrieved = await store.getMap("102934");
      expect(retrieved!.subflows).toHaveLength(1);
      expect(retrieved!.discovery_trace).toBeDefined();
      expect(retrieved!.test_records).toHaveLength(1);
    });
  });

  describe("listActivities", () => {
    it("returns latest version per activity", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "100" }));
      await store.saveMap(makeMinimalMap({ activity_id: "100" }));
      await store.saveMap(makeMinimalMap({ activity_id: "200" }));

      const list = await store.listActivities();
      expect(list).toHaveLength(2);

      const a100 = list.find((a) => a.activity_id === "100");
      expect(a100!.version).toBe(2);
    });

    it("filters by verified", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "100", verified: false }));
      await store.saveMap(makeMinimalMap({ activity_id: "200", verified: true, verified_at: "2026-04-27T00:00:00Z" }));

      const verified = await store.listActivities({ verified: true });
      expect(verified).toHaveLength(1);
      expect(verified[0].activity_id).toBe("200");

      const unverified = await store.listActivities({ verified: false });
      expect(unverified).toHaveLength(1);
      expect(unverified[0].activity_id).toBe("100");
    });

    it("filters by lifecycle_phase", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "100" }));
      await store.saveMap(makeMinimalMap({ activity_id: "200" }));
      await store.setLifecyclePhase("200", "discovered");

      const discovered = await store.listActivities({ lifecycle_phase: "discovered" });
      expect(discovered).toHaveLength(1);
      expect(discovered[0].activity_id).toBe("200");
    });
  });

  describe("lifecycle phase", () => {
    it("returns unresearched by default", async () => {
      const phase = await store.getLifecyclePhase("unknown");
      expect(phase).toBe("unresearched");
    });

    it("returns unresearched for a saved activity with no explicit phase", async () => {
      await store.saveMap(makeMinimalMap());
      const phase = await store.getLifecyclePhase("102934");
      expect(phase).toBe("unresearched");
    });

    it("updates phase and logs transition", async () => {
      await store.saveMap(makeMinimalMap());
      await store.setLifecyclePhase("102934", "researched");

      const phase = await store.getLifecyclePhase("102934");
      expect(phase).toBe("researched");

      await store.setLifecyclePhase("102934", "discovered");
      const phase2 = await store.getLifecyclePhase("102934");
      expect(phase2).toBe("discovered");
    });
  });

  describe("appendTestRecord", () => {
    it("appends a test record and creates a new version", async () => {
      await store.saveMap(makeMinimalMap());
      const record = makeTestRecord({ run_id: "tr-100", passed: true });
      await store.appendTestRecord("102934", record);

      const map = await store.getMap("102934");
      expect(map!.version).toBe(2);
      expect(map!.test_records).toHaveLength(1);
      expect(map!.test_records![0].run_id).toBe("tr-100");
    });

    it("throws for nonexistent activity", async () => {
      const record = makeTestRecord();
      await expect(store.appendTestRecord("missing", record)).rejects.toThrow("No map found");
    });
  });

  describe("appendDriftSignal", () => {
    it("appends a drift signal and creates a new version", async () => {
      await store.saveMap(makeMinimalMap());
      const signal = makeDriftSignal({ field_id: "f1", signal_type: "selector_miss" });
      await store.appendDriftSignal("102934", signal);

      const map = await store.getMap("102934");
      expect(map!.version).toBe(2);
      expect(map!.drift_signals).toHaveLength(1);
      expect(map!.drift_signals![0].field_id).toBe("f1");
    });

    it("throws for nonexistent activity", async () => {
      const signal = makeDriftSignal();
      await expect(store.appendDriftSignal("missing", signal)).rejects.toThrow("No map found");
    });
  });

  describe("getMapHistory", () => {
    it("returns all versions in descending order", async () => {
      await store.saveMap(makeMinimalMap());
      await store.saveMap(makeMinimalMap());
      await store.saveMap(makeMinimalMap());

      const history = await store.getMapHistory("102934");
      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(3);
      expect(history[1].version).toBe(2);
      expect(history[2].version).toBe(1);
    });

    it("respects limit parameter", async () => {
      await store.saveMap(makeMinimalMap());
      await store.saveMap(makeMinimalMap());
      await store.saveMap(makeMinimalMap());

      const history = await store.getMapHistory("102934", 2);
      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(3);
      expect(history[1].version).toBe(2);
    });

    it("returns empty array for nonexistent activity", async () => {
      const history = await store.getMapHistory("nonexistent");
      expect(history).toEqual([]);
    });
  });

  describe("isolation", () => {
    it("different activities do not interfere", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "A" }));
      await store.saveMap(makeMinimalMap({ activity_id: "B" }));
      await store.saveMap(makeMinimalMap({ activity_id: "A" }));

      const mapA = await store.getMap("A");
      const mapB = await store.getMap("B");
      expect(mapA!.version).toBe(2);
      expect(mapB!.version).toBe(1);
    });
  });
});
