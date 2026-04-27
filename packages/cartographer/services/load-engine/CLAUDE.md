# Load Engine

## Role
Deterministic Playwright execution — reads a verified UI Map and performs
field-by-field data entry. **No LLM cost.** This is the production
execution path.

## Scope
- `/packages/cartographer/services/load-engine/`

## Dependencies (contracts consumed)
- `contracts/load-engine-api.ts` — implements `LoadEngineAPI`
- `contracts/types/ui-map.ts` — reads `UIMap` for field selectors and actions

## Produces (contracts implemented)
- `LoadEngineAPI.load()` — single activity load
- `LoadEngineAPI.bulkLoad()` — sequential multi-activity load

## Acceptance Criteria
- Navigates to activity using map's navigation path
- Sets each field using selector fallback chain (primary → aria → text → coords)
- Clicks save, waits for success/error indicator
- Returns structured result with fields_set, errors, screenshots
- Zero LLM calls

## Test Coverage
- Unit: mock page, verify field-setting logic and selector fallback
- Integration: load test data into 102934 using a verified map
