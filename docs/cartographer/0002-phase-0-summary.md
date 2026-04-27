# Phase 0 Summary — CBC Cartographer

**Date:** 2026-04-27
**Author:** Architect Agent
**Branch:** `cartographer-dev`

## What Was Built

Phase 0 establishes the structural foundation for CBC Cartographer inside
the dealflow-ai-runner repository. No feature code was written — only
contracts, schemas, scaffolding, and documentation that future agents
build against.

### Workspace Registration (Step 2)
- Root `package.json` updated with `"workspaces": ["packages/*"]`
- `@dealflow/cartographer` workspace at `/packages/cartographer/`
- TypeScript 5.7, Vitest 3.1, ESLint 9 with `@typescript-eslint`
- Module resolution: ESNext + Bundler (best CJS interop for ajv etc.)

### Schemas (Steps 3-4)
- **UI Map schema** (`schemas/ui-map.schema.json`) — describes the
  complete structure of an activity's UI: navigation, fields (with
  multi-fallback selectors), actions, subflows, discovery trace, test
  records, and drift signals
- **Knowledge frontmatter schema** (`schemas/knowledge-frontmatter.schema.json`)
  — validates YAML frontmatter on all knowledge markdown files

Both schemas self-validate and accept dummy instances.

### TypeScript Types (Steps 3-4)
- `contracts/types/ui-map.ts` — generated from the UI Map schema
- `contracts/types/knowledge.ts` — generated from the frontmatter schema

### MCP Tool Definitions (Step 5)
- `contracts/mcp-tools.ts` — input/output types for all 12 MCP tools
- `docs/cartographer/mcp-api.md` — full tool reference documentation

### Component Interface Contracts (Steps 6-6a)
Nine contract files in `contracts/`, one per component:
- `store-api.ts`, `orchestrator-api.ts`, `load-engine-api.ts`
- `discovery-api.ts`, `verify-api.ts`, `repair-api.ts`
- `drift-api.ts`, `librarian-api.ts`, `researcher-api.ts`

The Researcher contract includes detailed input/output types, three error
modes (`insufficient_sources`, `allowlist_empty`, `matrix_unavailable`),
and a custom `ResearcherError` class.

### Knowledge Base (Step 7)
- Seeded activity: `102934_terms_of_payment/` with three human-written
  files (overview, gotchas, test data recipes) — copied verbatim from
  `/seed/102934/`
- Seven general knowledge placeholders (CBC navigation, UI5 patterns,
  SAP terminology, selector strategies, error dictionary, standard
  conventions, priority activities)
- Source cache directories with gitignored contents

### CLAUDE.md Hierarchy (Step 8)
- Top-level `/packages/cartographer/CLAUDE.md` with pre-flight/post-flight
  checklists, lifecycle rules, architecture overview, and cost guardrails
- 10 service-level `CLAUDE.md` stubs (one per component) specifying role,
  scope, dependencies, acceptance criteria, and test coverage requirements

### CI Workflow (Step 9)
- `.github/workflows/cartographer-ci.yml` — triggers only on
  `packages/cartographer/**` changes
- Five jobs: typecheck, lint, schema validation, unit tests, contract
  conformance tests
- Does not affect existing DealFlow CI (there was none)

### Cost Telemetry (Step 10)
- SQLite schema at `.telemetry/llm-costs.db` (gitignored)
- `services/telemetry/cost-logger.ts` — `logCost()` function for all agents
- `services/telemetry/daily-summary.ts` — per-phase and per-activity
  cost aggregation script

### Researcher Policy (Step 6a)
- `docs/cartographer/researcher-policy.md` — source allowlist, quality
  scoring, hybrid approval gate, insufficient-sources fallback chain,
  uncertainty markup, and $2/activity cost target

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | Stay on npm | Clean setup, one dep, CF buildpack native support |
| Monorepo style | npm workspaces | One-line change, zero risk to existing code |
| Cartographer location | `/packages/cartographer/` | Existing runner stays at root, untouched |
| Module resolution | ESNext + Bundler | Best interop with CJS deps (ajv, better-sqlite3) |
| Test framework | Vitest | Fast, ESM-native, works with TypeScript out of the box |
| Schema format | JSON Schema draft-07 | Widely supported, ajv validates at runtime |

## Divergences from Brief

- **Knowledge frontmatter schema relaxed** to accommodate human-provided
  seed files: `activity_id` accepts numbers (YAML parses `102934` as int),
  `sources` made optional, added `activity_name`, `scope_item_refs`, and
  `purpose` fields. Brief said "copy seed files verbatim, do not edit
  content," so the schema adapted instead.

## What's Intentionally Not Built Yet

Each component has a `CLAUDE.md` brief describing its contract and
acceptance criteria. None have implementation code. The build order for
subsequent phases:

1. **Map Store** — data layer comes first (everything depends on it)
2. **Orchestrator** — lifecycle enforcement
3. **Load Engine** — deterministic execution (no LLM needed)
4. **Researcher Agent** — knowledge seeding
5. **Discovery Agent** — UI walking
6. **Verify Loop** — testing maps
7. **Repair Agent** — fixing maps
8. **Drift Monitor** — change detection
9. **Librarian Agent** — knowledge curation
10. **MCP Server** — external interface

## The Research → Discovery → Verify Lifecycle

Every CBC activity goes through a strict lifecycle:

```
Research → [Approval Gate] → Discovery → Verify → Production
```

**Research:** The Researcher Agent searches trusted web sources (help.sap.com,
community.sap.com, etc.) and in-app CBC help to produce three knowledge
files per activity: overview, gotchas, and test data recipes.

**Approval Gate:** If the Researcher's overall confidence is `high`, the
output auto-merges and Discovery queues automatically. If `medium` or
`low`, a human must approve before Discovery can run.

**Discovery:** The Discovery Agent walks the live CBC UI, capturing every
field, selector, and action into a UI Map JSON document.

**Verify:** The Verify Loop tests the UI Map with synthetic data from the
test recipes. On failure, it calls the Repair Agent, which patches the
map, and re-tests. After passing, the map is marked verified and
eligible for production loads.

**Production:** The Load Engine reads the verified map and executes
deterministic Playwright commands with zero LLM cost.

## How to Run Locally

```bash
# From repo root
npm install

# From packages/cartographer/
npx tsc --noEmit           # TypeScript check
npx vitest run             # Unit + schema + contract tests
npx eslint . --ext .ts     # Lint
node --import tsx test/validate-schemas.ts  # Schema validation
```

## How to Extend

1. Pick the next component from the build order above
2. Read its `services/<component>/CLAUDE.md` for scope and acceptance criteria
3. Read its contract in `contracts/<component>-api.ts`
4. Implement in `services/<component>/`
5. Add tests in `test/`
6. Run typecheck + tests before committing
