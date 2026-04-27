# Cartographer — Agent Instructions

CBC Cartographer maps, verifies, and loads SAP CBC customizing activities.
Read this file in full before starting any work.

## Pre-flight (mandatory before any work)

1. Read this file (`/packages/cartographer/CLAUDE.md`)
2. Read all files in `/packages/cartographer/knowledge/general/*.md`
3. If working on a specific activity, read `/packages/cartographer/knowledge/activities/<id>/*.md`
4. If a UI Map exists for the activity, read it from the Map Store

## Post-flight (mandatory after any work)

1. Update `knowledge/general/error_dictionary.md` if anything broke
2. Update relevant `gotchas.md` if surprising behaviour was discovered
3. If a non-obvious technique worked, note it in the relevant knowledge file
4. If UI changes were detected, log in the activity's drift history

## Lifecycle

Every activity follows a strict lifecycle. **No phase may be skipped.**

```
Research → Discovery → Verify → Production
```

The Orchestrator enforces ordering. If you are asked to load an activity
that has no Researcher output, Research runs first.

### Hybrid Approval Gate (Research → Discovery)

| Researcher confidence | What happens |
|----------------------|--------------|
| `high` | Auto-merges, Discovery queues automatically |
| `medium` or `low` | Requires human approval before Discovery runs |

See `/docs/cartographer/researcher-policy.md` for full policy.

## Architecture

| # | Component | Role |
|---|-----------|------|
| 0 | Researcher Agent | Seeds knowledge from web + in-app help |
| 1 | Discovery Agent | Walks the UI, produces candidate UI Map |
| 2 | Verify Loop | Tests Map with synthetic data, iterates |
| 3 | Load Engine | Deterministic Playwright execution, no LLM |
| 4 | Repair Agent | Patches Map and knowledge on failure |
| 5 | Drift Monitor | Detects UI changes ahead of production failures |
| 6 | Librarian Agent | Curates knowledge base, promotes patterns |
| 7 | Orchestrator | Enforces lifecycle order, manages job queue |
| 8 | Map Store | Postgres + JSON schema, source of truth |
| 9 | MCP Server | Exposes everything to consumers |

## Contracts

All inter-component interfaces are defined in `/packages/cartographer/contracts/`.
Read the relevant contract before implementing or modifying a component.

## Boundary Policy

- Cartographer **must not** import from DealFlow AI source code
- DealFlow AI **may** import from Cartographer (consumer direction)
- No shared utility packages unless explicitly extracted and approved

## Key Files

- Schemas: `schemas/ui-map.schema.json`, `schemas/knowledge-frontmatter.schema.json`
- Types: `contracts/types/ui-map.ts`, `contracts/types/knowledge.ts`
- MCP tools: `contracts/mcp-tools.ts`
- Component APIs: `contracts/*-api.ts`
- Knowledge base: `knowledge/`
- Telemetry: `services/telemetry/`

## Cost Guardrails

- Researcher: $2 per activity (use Sonnet, not Opus)
- Discovery: target $5 per activity
- Verify: target $3 per activity
- Load Engine: $0 (no LLM)
- All costs logged to `.telemetry/llm-costs.db`
