# Discovery Agent

## Role
Walks the CBC UI for a customizing activity using Playwright + LLM vision,
producing a candidate UI Map that describes every field, action, and subflow.

## Scope
- `/packages/cartographer/services/discovery/`

## Dependencies (contracts consumed)
- `contracts/discovery-api.ts` — implements `DiscoveryAPI`
- `contracts/types/ui-map.ts` — `UIMap` structure for output
- `schemas/ui-map.schema.json` — validates output map
- Knowledge files for the activity (pre-flight reading)

## Produces (contracts implemented)
- `DiscoveryAPI.discover()` — main entry point

## Acceptance Criteria
- Produces a UI Map that validates against the JSON schema
- All visible fields on the activity screen are captured
- Selectors include primary + at least one fallback
- Navigation path is complete from Fiori launchpad
- Cost and duration logged to telemetry

## Test Coverage
- Unit: mock page interactions, verify map structure
- Schema: output validates against ui-map.schema.json
- Integration: discovery of seeded 102934 activity produces a usable map
