import type { UIMap, TestRecord, DriftSignal } from "../../contracts/types/ui-map.js";

export function makeMinimalMap(overrides?: Partial<UIMap>): UIMap {
  return {
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
    ...overrides,
  };
}

export function makeFullMap(overrides?: Partial<UIMap>): UIMap {
  return {
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
      cancel: { selectors: { primary: "button.cancel" } },
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
    ...overrides,
  };
}

export function makeTestRecord(overrides?: Partial<TestRecord>): TestRecord {
  return {
    run_id: `tr-${Date.now()}`,
    passed: true,
    timestamp: new Date().toISOString(),
    duration_ms: 1000,
    ...overrides,
  };
}

export function makeDriftSignal(overrides?: Partial<DriftSignal>): DriftSignal {
  return {
    detected_at: new Date().toISOString(),
    field_id: "f1",
    signal_type: "selector_miss",
    detail: "Primary selector not found",
    ...overrides,
  };
}
