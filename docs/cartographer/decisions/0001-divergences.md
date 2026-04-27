# Divergences from Architect Agent Brief

## 0001 — Knowledge frontmatter schema relaxed for seed files

**Date:** 2026-04-27
**Affects:** `schemas/knowledge-frontmatter.schema.json`, `contracts/types/knowledge.ts`

**Brief said:** Define a strict frontmatter schema. Also: copy seed files verbatim, do not edit content.

**What happened:** The human-provided seed files at `/seed/102934/` use frontmatter
conventions that don't match a strict reading of Step 4:

- `activity_id: 102934` — YAML parses as integer, schema expected string
- `overview.md` has `activity_name` and `scope_item_refs` fields not listed in Step 4
- `test_data_recipes.md` has `purpose` field and no `sources` array

**Decision:** Relaxed the schema to accommodate the seed files rather than editing them.
`activity_id` accepts string or integer, `sources` is optional, and `activity_name`,
`scope_item_refs`, and `purpose` are valid optional fields.

**Rationale:** "Do not edit content" is a stronger constraint than the schema spec.
The schema should describe reality, not force reality to conform. Future Researcher
output will follow the tighter conventions (string IDs, sources always present).

## 0002 — Module resolution changed from Node16 to Bundler

**Date:** 2026-04-27
**Affects:** `packages/cartographer/tsconfig.json`

**Brief said:** Nothing specific about module resolution.

**What happened:** Initial `Node16` module resolution caused type errors with
CJS-only packages (ajv, ajv-formats, better-sqlite3). These packages export
CommonJS modules that don't have proper ESM type declarations.

**Decision:** Switched to `module: "ESNext"` + `moduleResolution: "Bundler"`,
which handles CJS interop correctly. Vitest uses a bundler internally anyway,
so runtime behavior is unchanged.

**Rationale:** Clean typecheck is a Phase 0 acceptance criterion. Bundler
resolution is the standard recommendation for modern TypeScript projects
that run through a bundler or transpiler (tsx, vitest).
