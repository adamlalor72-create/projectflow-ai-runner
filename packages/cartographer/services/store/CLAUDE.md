# Map Store

## Role
Postgres + JSON schema storage for UI Maps and activity lifecycle state.
Source of truth for all map versions, test records, and drift signals.

## Scope
- `/packages/cartographer/services/store/`

## Dependencies (contracts consumed)
- `contracts/store-api.ts` — implements `StoreAPI`
- `contracts/types/ui-map.ts` — `UIMap`, `TestRecord`, `DriftSignal`
- `schemas/ui-map.schema.json` — validates maps on write

## Produces (contracts implemented)
- `StoreAPI.getMap()` / `saveMap()` — CRUD for UI Maps
- `StoreAPI.listActivities()` — activity listing with filters
- `StoreAPI.getLifecyclePhase()` / `setLifecyclePhase()` — phase tracking
- `StoreAPI.appendTestRecord()` / `appendDriftSignal()` — append-only records
- `StoreAPI.getMapHistory()` — version history

## Acceptance Criteria
- Maps are validated against the JSON schema before saving
- Version is auto-incremented on save
- Full version history is preserved (no destructive updates)
- Lifecycle phase transitions are logged

## Test Coverage
- Unit: in-memory store implementation for testing other components
- Integration: Postgres round-trip (save, read, list, history)
- Schema: saved maps validate against ui-map.schema.json
