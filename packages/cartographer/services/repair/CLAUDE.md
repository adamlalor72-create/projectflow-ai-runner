# Repair Agent

## Role
Patches a UI Map when the Load Engine or Verify Loop encounters a failure.
Uses LLM vision to identify what changed and update selectors, field types,
or field lists.

## Scope
- `/packages/cartographer/services/repair/`

## Dependencies (contracts consumed)
- `contracts/repair-api.ts` — implements `RepairAPI`
- `contracts/types/ui-map.ts` — reads and modifies `UIMap`

## Produces (contracts implemented)
- `RepairAPI.repair()` — main entry point

## Acceptance Criteria
- Takes a failed map + error context, returns a patched map
- Changes are itemised (field_id, change_type, old/new values)
- Patched map validates against the UI Map schema
- Cost logged to telemetry

## Test Coverage
- Unit: given a broken selector scenario, verify repair output
- Schema: repaired map validates against ui-map.schema.json
