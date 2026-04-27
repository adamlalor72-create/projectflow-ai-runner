# Cartographer MCP API

Tools exposed by the Cartographer MCP server to DealFlow AI and future consumers.

## Tool Reference

### `list_activities`

List all mapped CBC customizing activities.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filter.verified` | boolean | no | Filter by verification status |
| `filter.lifecycle_phase` | string | no | Filter by phase: `unresearched`, `researched`, `discovered`, `verified`, `production`, `drifted`, `failed` |
| `limit` | number | no | Max results (default 50) |
| `offset` | number | no | Pagination offset |

**Output:** `{ activities: ActivitySummary[], total: number }`

---

### `describe_activity`

Get the full UI Map, knowledge metadata, and lifecycle phase for one activity.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | yes | SAP activity ID |

**Output:** `{ map: UIMap, knowledge: KnowledgeFrontmatter | null, lifecycle_phase: string }`

---

### `research_activity`

Run the Researcher Agent on an activity. Seeds the knowledge base from web sources and in-app help. Subject to the hybrid approval gate (see researcher-policy.md).

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | yes | SAP activity ID |
| `activity_name` | string | no | Human-readable name |
| `scope_item_refs` | string[] | no | Related scope items |

**Output:** `{ files_written, sources_cited, uncertainty_flags, overall_confidence, cost_usd, duration_ms }`

**Errors:** `insufficient_sources`, `allowlist_empty`, `matrix_unavailable`

---

### `discover_activity`

Run the Discovery Agent to walk the UI and produce a candidate UI Map. Requires Researcher output to exist (Orchestrator enforces this).

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | yes | SAP activity ID |
| `activity_name` | string | no | Name hint for navigation |
| `force` | boolean | no | Re-discover even if a map exists |

**Output:** `{ map: UIMap, is_new, fields_found, cost_usd, duration_ms }`

---

### `verify_activity`

Run the Verify Loop — tests the UI Map with synthetic data and iterates on failures.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | yes | SAP activity ID |
| `max_iterations` | number | no | Max verify/repair cycles (default 3) |

**Output:** `{ passed, iterations, failures, map_version, cost_usd, duration_ms }`

---

### `load_activity`

Execute a deterministic load using a verified UI Map. No LLM cost.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | yes | SAP activity ID |
| `data` | object | yes | Field values to enter |
| `dry_run` | boolean | no | Validate without executing |

**Output:** `{ success, fields_set, errors, screenshots, duration_ms }`

---

### `bulk_load`

Load multiple activities in sequence.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | array | yes | Array of `{ activity_id, data }` |
| `dry_run` | boolean | no | Validate without executing |
| `stop_on_error` | boolean | no | Halt on first failure |

**Output:** `{ results: LoadResult[], total_duration_ms }`

---

### `diff_activity`

Check for UI drift since the last verified map.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | yes | SAP activity ID |

**Output:** `{ has_drift, signals: DriftSignal[], last_verified_at, current_version }`

---

### `get_activity_knowledge`

Retrieve all knowledge files for an activity.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | yes | SAP activity ID |

**Output:** `{ files: [{ path, frontmatter, content }] }`

---

### `search_knowledge`

Full-text search across the knowledge base.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Search text |
| `scope` | string | no | `activities`, `general`, or `all` (default) |
| `limit` | number | no | Max results |

**Output:** `{ results: [{ path, activity_id, snippet, relevance }] }`

---

### `get_failure_patterns`

Retrieve known failure patterns from the knowledge base.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activity_id` | string | no | Filter to one activity |
| `limit` | number | no | Max results |

**Output:** `{ patterns: [{ pattern, occurrences, last_seen, affected_activities, resolution }] }`

---

### `get_general_patterns`

Retrieve reusable patterns promoted by the Librarian.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | no | Filter by category |
| `limit` | number | no | Max results |

**Output:** `{ patterns: [{ category, pattern, description, source }] }`

---

## Lifecycle Enforcement

The Orchestrator enforces a strict lifecycle for every activity:

```
Research -> Discovery -> Verify -> Production
```

- Calling `load_activity` on an unresearched activity will queue Research first.
- Calling `discover_activity` without Researcher output will queue Research first.
- The hybrid approval gate (see researcher-policy.md) applies between Research and Discovery.

## Error Handling

All tools return structured errors. MCP clients should check for:
- `lifecycle_violation` — phase prerequisite not met
- `activity_not_found` — no map or knowledge for this activity ID
- `map_not_verified` — attempting load with unverified map
- Tool-specific errors documented on each tool above
