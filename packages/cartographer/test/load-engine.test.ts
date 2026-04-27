import { describe, it, expect } from "vitest";
import { LoadEngine } from "../services/load-engine/index.js";
import { createMockPage, createMockLocator } from "./helpers/mock-page.js";
import { makeMinimalMap } from "./helpers/fixtures.js";

describe("LoadEngine", () => {
  describe("load", () => {
    it("fills fields using primary selector", async () => {
      const fieldLocator = createMockLocator();
      const page = createMockPage({ "#ptKey": fieldLocator });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const result = await engine.load(map, { f1: "NT30" });

      expect(result.success).toBe(true);
      expect(result.fields_set).toBe(1);
      expect(result.fields_skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(fieldLocator.calls).toContain("fill:NT30");
    });

    it("skips fields with no data", async () => {
      const page = createMockPage();
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const result = await engine.load(map, {});

      expect(result.success).toBe(true);
      expect(result.fields_set).toBe(0);
      expect(result.fields_skipped).toBe(1);
    });

    it("reports errors when selector fails", async () => {
      const brokenLocator = createMockLocator({ throwOnWaitFor: true });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const result = await engine.load(map, { f1: "NT30" });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field_id).toBe("f1");
    });

    it("falls back to aria selector when primary fails", async () => {
      const brokenPrimary = createMockLocator({ throwOnWaitFor: true });
      const ariaLocator = createMockLocator();
      const page = createMockPage({
        "#ptKey": brokenPrimary,
        "aria:Payment Terms Key": ariaLocator,
      });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap({
        fields: [
          {
            id: "f1",
            label: "Payment Terms Key",
            type: "text",
            selectors: {
              primary: "#ptKey",
              fallback_aria: "Payment Terms Key",
            },
          },
        ],
      });

      const result = await engine.load(map, { f1: "NT30" });
      expect(result.success).toBe(true);
      expect(ariaLocator.calls).toContain("fill:NT30");
    });

    it("navigates using deep_link when available", async () => {
      const page = createMockPage();
      const engine = new LoadEngine(page);

      const map = makeMinimalMap({
        navigation: {
          path: ["Home"],
          deep_link: "#config/102934",
        },
      });

      await engine.load(map, {});
      expect(page.gotoHistory).toContain("#config/102934");
    });

    it("handles dry_run mode", async () => {
      const fieldLocator = createMockLocator();
      const page = createMockPage({ "#ptKey": fieldLocator });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const result = await engine.load(map, { f1: "NT30" }, { dry_run: true });

      expect(result.success).toBe(true);
      expect(result.fields_set).toBe(1);
      expect(fieldLocator.calls).toHaveLength(0);
    });

    it("captures screenshot on error when option is set", async () => {
      const brokenLocator = createMockLocator({ throwOnWaitFor: true });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const result = await engine.load(
        map,
        { f1: "NT30" },
        { screenshot_on_error: true }
      );

      expect(result.success).toBe(false);
      expect(result.screenshots).toHaveLength(1);
    });
  });

  describe("field types", () => {
    it("handles checkbox toggle", async () => {
      const loc = createMockLocator({ checked: false });
      const page = createMockPage({ "#cb": loc });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap({
        fields: [
          {
            id: "cb1",
            label: "Active",
            type: "checkbox",
            selectors: { primary: "#cb" },
          },
        ],
      });

      await engine.load(map, { cb1: true });
      expect(loc.calls).toContain("check");
    });

    it("handles dropdown with enumeration", async () => {
      const loc = createMockLocator();
      const page = createMockPage({ "#dd": loc });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap({
        fields: [
          {
            id: "dd1",
            label: "Terms",
            type: "dropdown",
            selectors: { primary: "#dd" },
            enumeration: [
              { value: "NT30", label: "Net 30" },
              { value: "NT60", label: "Net 60" },
            ],
          },
        ],
      });

      await engine.load(map, { dd1: "NT30" });
      expect(loc.calls).toContain("selectOption:Net 30");
    });

    it("handles file input", async () => {
      const loc = createMockLocator();
      const page = createMockPage({ "#file": loc });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap({
        fields: [
          {
            id: "file1",
            label: "Upload",
            type: "file",
            selectors: { primary: "#file" },
          },
        ],
      });

      await engine.load(map, { file1: "/tmp/data.csv" });
      expect(loc.calls).toContain("setInputFiles:/tmp/data.csv");
    });
  });

  describe("bulkLoad", () => {
    it("processes all items", async () => {
      const page = createMockPage();
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const results = await engine.bulkLoad([
        { map, data: {} },
        { map, data: {} },
        { map, data: {} },
      ]);

      expect(results).toHaveLength(3);
    });

    it("stops on first error when stop_on_error is true", async () => {
      const brokenLocator = createMockLocator({ throwOnWaitFor: true });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const results = await engine.bulkLoad(
        [
          { map, data: { f1: "A" } },
          { map, data: { f1: "B" } },
          { map, data: { f1: "C" } },
        ],
        { stop_on_error: true }
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
    });

    it("continues on error when stop_on_error is false", async () => {
      const brokenLocator = createMockLocator({ throwOnWaitFor: true });
      const page = createMockPage({ "#ptKey": brokenLocator });
      const engine = new LoadEngine(page);

      const map = makeMinimalMap();
      const results = await engine.bulkLoad(
        [
          { map, data: { f1: "A" } },
          { map, data: { f1: "B" } },
        ],
        { stop_on_error: false }
      );

      expect(results).toHaveLength(2);
    });
  });
});
