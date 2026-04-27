import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

describe("UI Map Schema", () => {
  const schema = JSON.parse(
    readFileSync(path.join(root, "schemas/ui-map.schema.json"), "utf8")
  );
  const validate = ajv.compile(schema);

  it("accepts a minimal valid UI Map", () => {
    const map = {
      activity_id: "102934",
      name: "Maintain Terms of Payment",
      version: 1,
      verified: false,
      navigation: { path: ["Home", "Configure"] },
      fields: [
        {
          id: "f1",
          label: "Payment Terms Key",
          type: "text",
          selectors: { primary: "#ptKey" },
        },
      ],
      actions: {
        save: { selectors: { primary: "button.save" } },
        cancel: { selectors: { primary: "button.cancel" } },
      },
    };
    expect(validate(map)).toBe(true);
  });

  it("rejects a map missing required fields", () => {
    const bad = { activity_id: "x" };
    expect(validate(bad)).toBe(false);
  });

  it("accepts a fully populated map", () => {
    const full = {
      activity_id: "102934",
      name: "Maintain Terms of Payment",
      scope_item_refs: ["2AJ"],
      version: 3,
      verified: true,
      verified_at: "2026-04-27T12:00:00Z",
      navigation: {
        path: ["Home", "Configure Your Solution", "Finance"],
        deep_link: "#BusinessConfiguration-configure&/activities/102934",
      },
      fields: [
        {
          id: "pt_key",
          label: "Payment Terms Key",
          type: "text",
          required: true,
          selectors: {
            primary: "#ptKey",
            fallback_aria: "Payment Terms Key",
            fallback_text: null,
            fallback_coords: { x: 100, y: 200 },
          },
          enumeration: [{ value: "NT30", label: "Net 30" }],
          f4_help: null,
          depends_on: null,
          affects: ["description"],
          validation: { pattern: "^[A-Z0-9]{4}$" },
        },
      ],
      actions: {
        save: {
          selectors: { primary: "button.save" },
          indicators: { success: ".toast-success", error: ".toast-error" },
        },
        cancel: {
          selectors: { primary: "button.cancel" },
        },
      },
      subflows: [
        {
          name: "Day Limit Split",
          trigger: { primary: "#dayLimitBtn" },
          fields: [
            {
              id: "day_limit",
              label: "Day Limit",
              type: "number",
              selectors: { primary: "#dayLimit" },
            },
          ],
        },
      ],
      discovery_trace: {
        agent_version: "0.1.0",
        discovered_at: "2026-04-27T10:00:00Z",
        duration_ms: 45000,
        screenshot_count: 12,
      },
      test_records: [
        {
          run_id: "tr-001",
          passed: true,
          timestamp: "2026-04-27T11:00:00Z",
          duration_ms: 30000,
        },
      ],
      drift_signals: [],
    };
    expect(validate(full)).toBe(true);
  });
});

describe("Knowledge Frontmatter Schema", () => {
  const schema = JSON.parse(
    readFileSync(path.join(root, "schemas/knowledge-frontmatter.schema.json"), "utf8")
  );
  const validate = ajv.compile(schema);

  it("accepts valid frontmatter", () => {
    const fm = {
      activity_id: "102934",
      last_updated: "2026-04-27T00:00:00Z",
      confidence: "medium",
      sources: ["https://help.sap.com/test"],
      verified_by: "human-pending",
    };
    expect(validate(fm)).toBe(true);
  });

  it("accepts frontmatter without optional activity_id", () => {
    const fm = {
      last_updated: "2026-04-27T00:00:00Z",
      confidence: "low",
      sources: [],
      verified_by: "human-pending",
    };
    expect(validate(fm)).toBe(true);
  });

  it("rejects invalid confidence value", () => {
    const fm = {
      last_updated: "2026-04-27T00:00:00Z",
      confidence: "very-high",
      sources: [],
      verified_by: "human-pending",
    };
    expect(validate(fm)).toBe(false);
  });
});

describe("Contract type smoke tests", () => {
  it("imports UI Map types without error", async () => {
    const mod = await import("../contracts/types/ui-map.js");
    expect(mod).toBeDefined();
  });

  it("imports Knowledge types without error", async () => {
    const mod = await import("../contracts/types/knowledge.js");
    expect(mod).toBeDefined();
  });

  it("imports MCP tool types without error", async () => {
    const mod = await import("../contracts/mcp-tools.js");
    expect(mod).toBeDefined();
  });
});
