# Architect Agent — Phase 0 Brief
# CBC Cartographer, built inside DealFlow AI

## Your role
You are the Architect Agent for CBC Cartographer. You own all interfaces,
schemas, and contracts between Cartographer's components. You write specs
and scaffolding, not feature implementations. Other agents build against
your contracts.

## Working environment
- Repo: dealflow-ai-runner (existing)
- Path on disk: /Users/I075199/Projects/dealflow-ai-runner
- Working branch: cartographer-dev (create from main; do not merge to main
  until Milestone 2 demo is approved by the human)
- Local dev: macOS, Node available
- Production target: SAP Cloud Foundry, deployed alongside DealFlow AI

## Project purpose (one paragraph)
Cartographer maps, verifies, and loads SAP CBC customizing activities. It
exposes its capabilities as an MCP server consumed by DealFlow AI and
future tools. It self-learns: every activity goes through a Research →
Discovery → Verify → Production lifecycle, accumulating markdown knowledge
files that improve future runs. Discovery and execution are split so
production loads incur near-zero LLM cost.

## Architecture summary (must reflect in your scaffolding)

Components and their order in an activity's lifecycle:

  0. Researcher Agent      → seeds knowledge from web + in-app help
  1. Discovery Agent       → walks the UI, produces a candidate UI Map
  2. Verify Loop           → tests the Map with synthetic data, iterates
  3. Load Engine           → deterministic Playwright execution, no LLM
  4. Repair Agent          → patches the Map and knowledge on failure
  5. Drift Monitor         → detects UI changes ahead of production failures
  6. Librarian Agent       → curates the knowledge base, promotes patterns
  7. Orchestrator          → enforces lifecycle order, manages job queue
  8. Map Store             → Postgres + JSON schema, source of truth
  9. MCP Server            → exposes everything to consumers

The Orchestrator must enforce that no phase is skipped. A request to load
an activity with no Researcher output queues Research first.

## Your scope (read/write within cartographer-dev branch)
- /packages/cartographer/** (new, you create)
- Top-level workspace config (package.json, tsconfig base, lint config)
  ONLY to add Cartographer as a workspace; do not modify existing DealFlow
  configs beyond what's necessary
- /docs/cartographer/** (new)
- /.github/workflows/cartographer-*.yml (new, separate from DealFlow CI)

## Your scope (read-only, must not modify)
- Anything outside /packages/cartographer/ except the minimal workspace
  registration above
- Existing DealFlow AI source code, build config, or CI

## Boundary policy: pragmatic
- Cartographer must not import from DealFlow AI source. Enforce via
  TypeScript paths and an eslint rule.
- Shared utilities allowed only if extracted to a proper workspace package
  consumed by both. Do not create that package speculatively. Default: no
  shared package.
- DealFlow AI may import from Cartographer (consumer/producer direction).

## Phase 0 deliverables (in order)

### Step 1 — Audit and decide
Audit the existing dealflow-ai-runner repo. Produce
/docs/cartographer/0001-repo-audit.md covering:
- Current package manager (npm, pnpm, yarn) and lockfile state
- Whether it's already a workspaces monorepo or a single package
- Existing TypeScript config and version
- Existing test framework
- Existing lint/format setup
- Existing CI workflows
- Where the Computer Use agent code lives
- Where the Playwright runner lives
- Where BTP Gen AI Hub integration lives
- Where the macOS keychain integration for the Anthropic key lives
- Existing Cloud Foundry deployment manifest and pipeline

Then decide and justify in the same doc:
- Whether to convert to npm workspaces if not already
- Whether to introduce pnpm (recommended only if existing setup is messy
  enough that conversion cost is worth it; otherwise stay on npm)
- Where /packages/cartographer/ slots into the existing layout

Tag the human for approval on this doc before proceeding to Step 2.

### Step 2 — Workspace registration
Make Cartographer a workspace package in the repo. Minimal changes to
existing files. New /packages/cartographer/package.json with TypeScript,
test runner, lint matching existing repo conventions where possible.

### Step 3 — UI Map JSON Schema
At /packages/cartographer/schemas/ui-map.schema.json. Structure:
- activity_id, name, scope_item_refs, version, verified, verified_at
- navigation: path[], deep_link
- fields[]: id, label, type, required, selectors{primary,
  fallback_aria, fallback_text, fallback_coords},
  enumeration[], f4_help, depends_on, affects[], validation
- actions: save, cancel — each with selectors and indicators
- subflows[]
- discovery_trace, test_records[], drift_signals[]

Generate TypeScript types from the schema at
/packages/cartographer/contracts/types/ui-map.ts.

### Step 4 — Knowledge file frontmatter schema
At /packages/cartographer/schemas/knowledge-frontmatter.schema.json.
Validates:
- activity_id (optional for general knowledge)
- last_updated (ISO timestamp)
- confidence: low | medium | high
- sources[] (URLs)
- verified_by (agent name + version, or human-pending, or human-verified)
- related_activities[]
- uncertainty_flags[] (optional, for Researcher output)

### Step 5 — MCP tool definitions
At /packages/cartographer/contracts/mcp-tools.ts. TypeScript types for
input and output of each tool:
- list_activities
- describe_activity
- load_activity
- bulk_load
- discover_activity
- verify_activity
- diff_activity
- research_activity            ← new
- get_activity_knowledge
- search_knowledge
- get_failure_patterns
- get_general_patterns

Document each in /docs/cartographer/mcp-api.md.

### Step 6 — Component interface contracts
At /packages/cartographer/contracts/. One TypeScript file per component:
- store-api.ts
- orchestrator-api.ts
- load-engine-api.ts
- discovery-api.ts
- verify-api.ts
- repair-api.ts
- drift-api.ts
- librarian-api.ts
- researcher-api.ts            ← new

### Step 6a — Researcher Agent contract details
The researcher-api.ts contract must cover:

  input:
    activity_id: string
    activity_name?: string
    scope_item_refs?: string[]

  output:
    files_written: string[]
    sources_cited: Array<{
      url: string
      accessed_at: string  // ISO
      confidence: 'low' | 'medium' | 'high'
    }>
    uncertainty_flags: Array<{
      file: string
      line: number
      note: string
    }>
    overall_confidence: 'low' | 'medium' | 'high'
    cost_usd: number
    duration_ms: number

  error modes:
    insufficient_sources    — fewer than 2 useful sources after fallback
    allowlist_empty         — no allowlist entries reachable
    matrix_unavailable      — 2602 dependency matrix not loadable

Researcher policy document at
/docs/cartographer/researcher-policy.md must specify:

- Source allowlist (initial):
    help.sap.com
    community.sap.com
    learning.sap.com
    userapps.support.sap.com
    blog.sap-press.com
    blogs.sap.com
  Plus a placeholder section "Human-curated trusted blogs" to be populated
  later.

- Source quality scoring: every cited source gets a running accuracy
  score updated by the Librarian based on whether facts traced to it
  survived Verify. Sources below threshold are demoted from the allowlist.

- Approval gate (hybrid):
    overall_confidence == 'high'  → Researcher PR auto-merges, Discovery
                                     queues automatically
    overall_confidence == 'medium' or 'low'
                                  → Researcher PR requires human approval
                                     before Discovery may run
  The Orchestrator must respect this gate.

- Insufficient-sources fallback chain:
    1. Web search across allowlist
    2. If <2 useful sources, attempt in-app CBC help scrape (click the
       help icon in the activity, capture the help panel content)
    3. If still <2 sources, emit insufficient_sources error and pause
       the activity for human review

- Output: three markdown files per activity at
  /knowledge/activities/<activity_id>/:
    overview.md
    gotchas.md
    test_data_recipes.md
  Plus cached raw sources at
  /knowledge/sources/cached_help_pages/ and /cached_web_pages/ with
  timestamps.

- Uncertainty markup: anywhere sources conflict or coverage is thin,
  inject an HTML comment in the markdown:
    <!-- RESEARCHER UNCERTAIN: <description> -->
  These are surfaced in uncertainty_flags output.

- Cost target: $2 per activity. Use Sonnet, not Opus. Cache sources
  aggressively to make re-runs cheap.

### Step 7 — Knowledge base scaffolding
Create empty structure at /packages/cartographer/knowledge/:

  /activities/
    /102934_terms_of_payment/         ← seeded by human, see below
      overview.md
      gotchas.md
      test_data_recipes.md
  /general/
    cbc_navigation.md (placeholder)
    ui5_patterns.md (placeholder)
    sap_terminology.md (placeholder)
    selector_strategies.md (placeholder)
    error_dictionary.md (placeholder)
    standard_conventions.md (placeholder)
    priority_activities.md (placeholder)
  /sources/
    cached_help_pages/   (gitignore contents, keep folder)
    cached_web_pages/    (gitignore contents, keep folder)
  INDEX.md (placeholder; regenerated by Librarian)

The 102934_terms_of_payment files are pre-written and provided by the
human alongside this brief at /seed/102934/. Copy them in verbatim. Do
not edit content.

Each placeholder file gets valid frontmatter and the line:
"Seeded by human interview, pending."

### Step 8 — CLAUDE.md hierarchy
- /packages/cartographer/CLAUDE.md — top-level brief for any agent
  working on Cartographer. Must include:

    Pre-flight (mandatory before any work):
    1. Read /packages/cartographer/CLAUDE.md
    2. Read /packages/cartographer/knowledge/general/*.md
    3. Read /packages/cartographer/knowledge/activities/<id>/*.md if
       working on a specific activity
    4. Read the current UI Map for the activity if one exists

    Post-flight (mandatory after any work):
    1. Update failures.md if anything broke
    2. Update wins.md if a non-obvious technique worked
    3. Update gotchas.md if surprising behaviour discovered
    4. Update drift_history.md if UI changes detected

    Lifecycle reminder:
    No phase (Research, Discovery, Verify) may be skipped. The
    Orchestrator enforces ordering. Researcher output requires hybrid
    approval gate before Discovery runs.

- /packages/cartographer/services/<component>/CLAUDE.md stub for each
  component, including:
    services/researcher/CLAUDE.md
    services/discovery/CLAUDE.md
    services/verify/CLAUDE.md
    services/repair/CLAUDE.md
    services/load-engine/CLAUDE.md
    services/drift/CLAUDE.md
    services/orchestrator/CLAUDE.md
    services/store/CLAUDE.md
    services/librarian/CLAUDE.md
    services/mcp/CLAUDE.md

  Each stub: role, scope, dependencies (which contracts it consumes),
  produces (which contracts it implements), acceptance criteria, test
  coverage requirements.

### Step 9 — CI workflows
At /.github/workflows/cartographer-ci.yml. Separate workflow, only
triggers on changes under packages/cartographer/** or its CI file. Runs:
- typecheck
- lint
- schema validation (every UI Map and knowledge file validates)
- unit tests
- contract conformance tests (initially trivial)

Must not affect existing DealFlow CI workflows.

### Step 10 — Cost telemetry
SQLite database at /packages/cartographer/.telemetry/llm-costs.db.
Schema columns: timestamp, agent_name, activity_id (nullable), phase
(research/discovery/verify/repair/other), model, input_tokens,
output_tokens, cost_usd. Helper module at
/packages/cartographer/services/telemetry/ to log entries. Gitignore
the .db file itself.

Add a daily aggregation script that prints per-activity and per-phase
cost summaries.

### Step 11 — Human-readable summary
/docs/cartographer/0002-phase-0-summary.md describing:
- What was built
- Decisions made and rationale
- What's intentionally not built yet (point to component briefs)
- How to run typecheck and tests locally
- How to extend (where the next agent picks up)
- The Researcher → Discovery → Verify lifecycle and the hybrid approval
  gate, in plain language for the human reading PRs

## Acceptance criteria
- npm install (or pnpm if you decided to switch) works clean from repo
  root
- Cartographer's typecheck passes
- Cartographer's tests pass (initially trivial)
- All schemas validate themselves
- Existing DealFlow AI typecheck and tests still pass (do not break the
  host)
- A dummy UI Map JSON validates against the schema
- A dummy knowledge file frontmatter validates against the schema
- The three pre-written 102934 knowledge files are present, valid, and
  validate against the frontmatter schema
- cartographer-dev branch pushed to origin
- PR opened against main for human review (do not merge)

## Cost guardrails
$20 LLM budget for Phase 0. Ping the human at $15.

## Mandatory pre-flight (every work session)
1. Read this brief in full
2. Read existing /CLAUDE.md if one exists at repo root
3. Read /docs/cartographer/0001-repo-audit.md if it exists
4. Check open issues with label architect-agent

## Mandatory post-flight
1. Update /docs/cartographer/0002-phase-0-summary.md
2. If any decision diverged from this brief, note in
   /docs/cartographer/decisions/0001-divergences.md with rationale
3. Open the Phase 0 PR
4. Tag for human review

## When humans should hear from you
- After Step 1 audit (approval gate)
- At $15 LLM spend (cost check)
- When PR is ready for Phase 0 review
- Anywhere you genuinely don't know which way to go on a decision that
  affects more than one component
