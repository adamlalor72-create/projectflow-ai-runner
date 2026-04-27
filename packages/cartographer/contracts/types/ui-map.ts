/**
 * CBC Cartographer — UI Map Types
 * Generated from schemas/ui-map.schema.json
 */

export interface Selectors {
  primary: string;
  fallback_aria?: string | null;
  fallback_text?: string | null;
  fallback_coords?: { x: number; y: number } | null;
}

export interface Enumeration {
  value: string;
  label: string;
}

export interface F4Help {
  trigger?: Selectors;
  search_field?: Selectors;
  result_selector?: Selectors;
}

export interface Validation {
  pattern?: string;
  min?: number;
  max?: number;
  message?: string;
}

export interface Field {
  id: string;
  label: string;
  type:
    | "text"
    | "number"
    | "date"
    | "dropdown"
    | "checkbox"
    | "radio"
    | "file"
    | "textarea"
    | "table_cell"
    | "custom";
  required?: boolean;
  selectors: Selectors;
  enumeration?: Enumeration[];
  f4_help?: F4Help | null;
  depends_on?: string | null;
  affects?: string[];
  validation?: Validation | null;
}

export interface Action {
  selectors: Selectors;
  indicators?: {
    success?: string;
    error?: string;
    busy?: string;
  };
}

export interface Subflow {
  name: string;
  trigger: Selectors;
  fields: Field[];
  actions?: Record<string, Action>;
}

export interface DiscoveryTrace {
  agent_version?: string;
  discovered_at?: string;
  duration_ms?: number;
  screenshot_count?: number;
}

export interface TestRecord {
  run_id: string;
  passed: boolean;
  timestamp: string;
  errors?: string[];
  duration_ms?: number;
}

export type DriftSignalType =
  | "selector_miss"
  | "label_change"
  | "new_field"
  | "removed_field"
  | "layout_change";

export interface DriftSignal {
  detected_at: string;
  field_id: string;
  signal_type: DriftSignalType;
  detail?: string;
}

export interface UIMap {
  activity_id: string;
  name: string;
  scope_item_refs?: string[];
  version: number;
  verified: boolean;
  verified_at?: string | null;
  navigation: {
    path: string[];
    deep_link?: string | null;
  };
  fields: Field[];
  actions: {
    save: Action;
    cancel: Action;
  };
  subflows?: Subflow[];
  discovery_trace?: DiscoveryTrace | null;
  test_records?: TestRecord[];
  drift_signals?: DriftSignal[];
}
