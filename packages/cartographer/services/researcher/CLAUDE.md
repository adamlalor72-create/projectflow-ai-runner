# Researcher Agent

## Role
Seeds the knowledge base for a CBC customizing activity by searching
trusted web sources and scraping in-app help content.

## Scope
- `/packages/cartographer/services/researcher/`
- Writes to `/packages/cartographer/knowledge/activities/<id>/`
- Writes cached sources to `/packages/cartographer/knowledge/sources/`

## Dependencies (contracts consumed)
- `contracts/researcher-api.ts` — implements `ResearcherAPI`
- `contracts/types/knowledge.ts` — `KnowledgeFrontmatter` for file headers
- `schemas/knowledge-frontmatter.schema.json` — validates output files

## Produces (contracts implemented)
- `ResearcherAPI.research()` — main entry point

## Policy
See `/docs/cartographer/researcher-policy.md` for:
- Source allowlist
- Source quality scoring
- Hybrid approval gate
- Insufficient-sources fallback chain
- Cost target ($2/activity, use Sonnet)

## Acceptance Criteria
- Produces valid `overview.md`, `gotchas.md`, `test_data_recipes.md` per activity
- All files pass frontmatter schema validation
- Sources are from the allowlist only
- `uncertainty_flags` populated for any conflicting/thin sources
- Cost logged to telemetry

## Test Coverage
- Unit: mock web responses, verify output structure and frontmatter validity
- Integration: end-to-end research of a test activity against live sources
- Schema: all output files validate against knowledge-frontmatter schema
