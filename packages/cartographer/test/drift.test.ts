import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DriftMonitor } from "../services/drift/index.js";
import { MapStore } from "../services/store/index.js";
import { createMockPage, createMockLocator } from "./helpers/mock-page.js";
import { makeMinimalMap, makeDriftSignal } from "./helpers/fixtures.js";

let store: MapStore;

beforeEach(() => {
  store = new MapStore();
});

afterEach(() => {
  store.close();
});

describe("DriftMonitor", () => {
  describe("check", () => {
    it("returns no drift when all selectors resolve", async () => {
      await store.saveMap(makeMinimalMap());
      const page = createMockPage();
      const monitor = new DriftMonitor({ page, store });

      const result = await monitor.check("102934");
      expect(result.has_drift).toBe(false);
      expect(result.signals).toHaveLength(0);
    });

    it("detects drift when selector is not visible", async () => {
      await store.saveMap(makeMinimalMap());
      const brokenLocator = createMockLocator({ visible: false });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const monitor = new DriftMonitor({ page, store });

      const result = await monitor.check("102934");
      expect(result.has_drift).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].signal_type).toBe("selector_miss");
      expect(result.signals[0].field_id).toBe("f1");
    });

    it("returns no drift for nonexistent activity", async () => {
      const page = createMockPage();
      const monitor = new DriftMonitor({ page, store });

      const result = await monitor.check("nonexistent");
      expect(result.has_drift).toBe(false);
    });

    it("updates lifecycle to drifted on drift detection", async () => {
      await store.saveMap(makeMinimalMap());
      await store.setLifecyclePhase("102934", "verified");

      const brokenLocator = createMockLocator({ visible: false });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const monitor = new DriftMonitor({ page, store });

      await monitor.check("102934");
      const phase = await store.getLifecyclePhase("102934");
      expect(phase).toBe("drifted");
    });

    it("appends drift signals to store", async () => {
      await store.saveMap(makeMinimalMap());
      const brokenLocator = createMockLocator({ visible: false });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const monitor = new DriftMonitor({ page, store });

      await monitor.check("102934");
      const map = await store.getMap("102934");
      expect(map!.drift_signals).toHaveLength(1);
    });

    it("navigates using deep_link", async () => {
      await store.saveMap(
        makeMinimalMap({
          navigation: { path: ["Home"], deep_link: "#config/102934" },
        })
      );
      const page = createMockPage();
      const monitor = new DriftMonitor({ page, store });

      await monitor.check("102934");
      expect(page.gotoHistory).toContain("#config/102934");
    });
  });

  describe("getHistory", () => {
    it("returns empty for no signals", async () => {
      await store.saveMap(makeMinimalMap());
      const page = createMockPage();
      const monitor = new DriftMonitor({ page, store });

      const history = await monitor.getHistory("102934");
      expect(history).toEqual([]);
    });

    it("returns signals in reverse order", async () => {
      await store.saveMap(makeMinimalMap());
      await store.appendDriftSignal("102934", makeDriftSignal({ detail: "first" }));
      await store.appendDriftSignal("102934", makeDriftSignal({ detail: "second" }));

      const page = createMockPage();
      const monitor = new DriftMonitor({ page, store });

      const history = await monitor.getHistory("102934");
      expect(history).toHaveLength(2);
      expect(history[0].detail).toBe("second");
    });

    it("respects limit", async () => {
      await store.saveMap(makeMinimalMap());
      await store.appendDriftSignal("102934", makeDriftSignal({ detail: "1" }));
      await store.appendDriftSignal("102934", makeDriftSignal({ detail: "2" }));
      await store.appendDriftSignal("102934", makeDriftSignal({ detail: "3" }));

      const page = createMockPage();
      const monitor = new DriftMonitor({ page, store });

      const history = await monitor.getHistory("102934", 2);
      expect(history).toHaveLength(2);
    });
  });
});
