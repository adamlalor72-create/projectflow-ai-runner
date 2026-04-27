# Orchestrator

## Role
Enforces the activity lifecycle order and manages the job queue. No phase
may be skipped. A request to load an activity with no Researcher output
queues Research first.

## Scope
- `/packages/cartographer/services/orchestrator/`

## Dependencies (contracts consumed)
- `contracts/orchestrator-api.ts` — implements `OrchestratorAPI`
- `contracts/store-api.ts` — reads lifecycle phase
- `contracts/researcher-api.ts` — dispatches research jobs
- `contracts/discovery-api.ts` — dispatches discovery jobs
- `contracts/verify-api.ts` — dispatches verify jobs
- `contracts/load-engine-api.ts` — dispatches load jobs

## Produces (contracts implemented)
- `OrchestratorAPI.submit()` — queue a job
- `OrchestratorAPI.getJob()` / `listJobs()` — status queries
- `OrchestratorAPI.cancelJob()` — cancel a pending/running job
- `OrchestratorAPI.getRequiredPhase()` — what phase must complete first
- `OrchestratorAPI.isPhaseComplete()` — check if a phase is done

## Lifecycle enforcement
```
Research → [approval gate] → Discovery → Verify → Production
```

The hybrid approval gate between Research and Discovery is defined in
`/docs/cartographer/researcher-policy.md`.

## Acceptance Criteria
- Rejects out-of-order phase requests with a clear error
- Auto-queues prerequisite phases when needed
- Respects the hybrid approval gate
- Job status transitions are atomic and logged

## Test Coverage
- Unit: verify lifecycle ordering logic with mocked store
- Unit: verify approval gate blocks medium/low confidence research
- Integration: submit a load for unresearched activity, verify research queues first
