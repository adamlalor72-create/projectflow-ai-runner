# Verify Loop

## Role
Tests a candidate UI Map against the real CBC UI using synthetic test data.
Iterates with the Repair Agent on failures until the map passes or max
iterations are reached.

## Scope
- `/packages/cartographer/services/verify/`

## Dependencies (contracts consumed)
- `contracts/verify-api.ts` — implements `VerifyAPI`
- `contracts/types/ui-map.ts` — reads `UIMap`, appends `TestRecord`
- `contracts/repair-api.ts` — calls Repair Agent on failure
- Knowledge files: `test_data_recipes.md` for synthetic data

## Produces (contracts implemented)
- `VerifyAPI.verify()` — main entry point

## Acceptance Criteria
- Loads test data from recipes, executes against the live UI
- Records pass/fail per test record
- On failure, invokes Repair Agent and re-tests
- Final map version is saved to the Store with updated test_records
- Cost and duration logged to telemetry

## Test Coverage
- Unit: mock page + repair agent, verify iteration logic
- Integration: verify loop against 102934 with known-good map
