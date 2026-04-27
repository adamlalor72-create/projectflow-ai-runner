# Drift Monitor

## Role
Detects UI changes in CBC activities before they cause production load
failures. Compares the current UI against the verified UI Map and emits
drift signals.

## Scope
- `/packages/cartographer/services/drift/`

## Dependencies (contracts consumed)
- `contracts/drift-api.ts` — implements `DriftAPI`
- `contracts/types/ui-map.ts` — reads `UIMap`, appends `DriftSignal`
- `contracts/store-api.ts` — reads maps, writes drift signals

## Produces (contracts implemented)
- `DriftAPI.check()` — check one activity
- `DriftAPI.checkAll()` — check all verified activities
- `DriftAPI.getHistory()` — retrieve past drift signals

## Acceptance Criteria
- Navigates to activity, tests each field selector
- Emits typed drift signals: selector_miss, label_change, new_field, removed_field, layout_change
- Does not modify the map — only reports
- Signals stored via the Map Store

## Test Coverage
- Unit: mock page with altered selectors, verify signal detection
- Integration: detect intentional UI change in test environment
