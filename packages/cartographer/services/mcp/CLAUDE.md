# MCP Server

## Role
Exposes Cartographer capabilities as MCP tools consumed by DealFlow AI
and future integrations.

## Scope
- `/packages/cartographer/services/mcp/`

## Dependencies (contracts consumed)
- `contracts/mcp-tools.ts` — all tool input/output types
- `contracts/orchestrator-api.ts` — job submission
- `contracts/store-api.ts` — data queries

## Produces (contracts implemented)
MCP tools as defined in `contracts/mcp-tools.ts`:
- `list_activities`, `describe_activity`
- `load_activity`, `bulk_load`
- `discover_activity`, `verify_activity`, `diff_activity`
- `research_activity`
- `get_activity_knowledge`, `search_knowledge`
- `get_failure_patterns`, `get_general_patterns`

See `/docs/cartographer/mcp-api.md` for full documentation.

## Acceptance Criteria
- All tools conform to their defined input/output types
- Lifecycle enforcement delegated to Orchestrator (MCP server does not enforce directly)
- Error responses are structured and documented

## Test Coverage
- Unit: tool handler input validation and output shape
- Integration: MCP protocol round-trip with mock orchestrator
