/**
 * Schema Validation — validates UI Map and Knowledge Frontmatter schemas,
 * and checks the seeded 102934 knowledge files against the frontmatter schema.
 *
 * Run: node --import tsx test/validate-schemas.ts
 * Also invoked by: npm run validate:schemas
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

let errors = 0;

function check(label: string, pass: boolean, detail?: string) {
  if (pass) {
    console.log(`  OK  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ": " + detail : ""}`);
    errors++;
  }
}

// ── 1. UI Map schema self-validates ────────────────────────────

console.log("\n=== UI Map Schema ===");
const uiMapSchema = JSON.parse(
  readFileSync(path.join(root, "schemas/ui-map.schema.json"), "utf8")
);
const validateUIMap = ajv.compile(uiMapSchema);
check("Schema compiles", !!validateUIMap);

// Dummy UI Map
const dummyMap = {
  activity_id: "999999",
  name: "Test Activity",
  version: 1,
  verified: false,
  verified_at: null,
  navigation: {
    path: ["Home", "Configure Your Solution", "Test"],
    deep_link: null,
  },
  fields: [
    {
      id: "field_1",
      label: "Test Field",
      type: "text",
      required: true,
      selectors: {
        primary: "#testField",
        fallback_aria: null,
        fallback_text: null,
        fallback_coords: null,
      },
    },
  ],
  actions: {
    save: {
      selectors: { primary: "button[data-action='save']" },
    },
    cancel: {
      selectors: { primary: "button[data-action='cancel']" },
    },
  },
};

const mapValid = validateUIMap(dummyMap);
check(
  "Dummy UI Map validates",
  mapValid,
  mapValid ? undefined : JSON.stringify(validateUIMap.errors, null, 2)
);

// ── 2. Knowledge Frontmatter schema self-validates ─────────────

console.log("\n=== Knowledge Frontmatter Schema ===");
const kfSchema = JSON.parse(
  readFileSync(path.join(root, "schemas/knowledge-frontmatter.schema.json"), "utf8")
);
const validateKF = ajv.compile(kfSchema);
check("Schema compiles", !!validateKF);

// Dummy frontmatter
const dummyFM = {
  activity_id: "999999",
  last_updated: "2026-04-27T00:00:00Z",
  confidence: "medium",
  sources: ["https://help.sap.com/example"],
  verified_by: "human-pending",
};

const fmValid = validateKF(dummyFM);
check(
  "Dummy frontmatter validates",
  fmValid,
  fmValid ? undefined : JSON.stringify(validateKF.errors, null, 2)
);

// ── 3. Seeded 102934 knowledge files validate ──────────────────

console.log("\n=== Seeded Knowledge Files (102934) ===");
const activityDir = path.join(root, "knowledge/activities/102934_terms_of_payment");
const knowledgeFiles = readdirSync(activityDir).filter((f) => f.endsWith(".md"));

for (const file of knowledgeFiles) {
  const content = readFileSync(path.join(activityDir, file), "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    check(`${file} has frontmatter`, false, "No YAML frontmatter found");
    continue;
  }

  // Simple YAML parse — extract key-value pairs
  const yamlStr = fmMatch[1];
  const fm = parseSimpleYaml(yamlStr);
  check(`${file} has frontmatter`, true);

  const valid = validateKF(fm);
  check(
    `${file} frontmatter validates`,
    valid,
    valid ? undefined : JSON.stringify(validateKF.errors, null, 2)
  );
}

// ── Summary ────────────────────────────────────────────────────

console.log(`\n${errors === 0 ? "All checks passed." : `${errors} check(s) FAILED.`}`);
if (errors > 0) process.exit(1);

// ── Helpers ────────────────────────────────────────────────────

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let inArray = false;
  let arrayItems: unknown[] = [];

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (inArray) {
      if (trimmed.startsWith("- ")) {
        const itemVal = trimmed.slice(2).replace(/\s+#.*$/, "").trim().replace(/^"(.*)"$/, "$1");
        const num = Number(itemVal);
        arrayItems.push(!isNaN(num) && itemVal !== "" ? num : itemVal);
        continue;
      } else {
        result[currentKey] = arrayItems;
        inArray = false;
        arrayItems = [];
      }
    }

    const kv = trimmed.match(/^(\w+):\s*(.*)/);
    if (kv) {
      const [, key, rawVal] = kv;
      const val = rawVal.replace(/\s+#.*$/, "").trim();
      if (val === "" || val === "[]") {
        // Check next line for array items
        currentKey = key;
        if (val === "[]") {
          result[key] = [];
        } else {
          inArray = true;
          arrayItems = [];
        }
      } else if (val.startsWith('"') && val.endsWith('"')) {
        result[key] = val.slice(1, -1);
      } else if (val === "true") {
        result[key] = true;
      } else if (val === "false") {
        result[key] = false;
      } else if (val === "null") {
        result[key] = null;
      } else if (!isNaN(Number(val))) {
        result[key] = Number(val);
      } else {
        result[key] = val;
      }
    }
  }

  if (inArray) {
    result[currentKey] = arrayItems;
  }

  return result;
}
