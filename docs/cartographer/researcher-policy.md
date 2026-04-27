# Researcher Agent Policy

Governs how the Researcher Agent seeds the knowledge base for CBC customizing activities.

## Source Allowlist

The Researcher may only cite sources from the following domains:

### Trusted SAP domains
- `help.sap.com`
- `community.sap.com`
- `learning.sap.com`
- `userapps.support.sap.com`
- `blog.sap-press.com`
- `blogs.sap.com`

### Human-curated trusted blogs
<!-- Add trusted blog URLs here as they are identified and validated -->
*No entries yet. To add a blog:*
1. *Verify at least 3 factual claims from the blog against SAP documentation*
2. *Add the domain here with the date it was verified*
3. *The Librarian will track its ongoing accuracy score*

## Source Quality Scoring

Every cited source receives a running accuracy score maintained by the Librarian Agent:

- **Initial score:** 1.0 (neutral)
- **On Verify pass:** score += 0.1 for each fact traced to this source that survived
- **On Verify fail:** score -= 0.2 for each fact traced to this source that failed
- **Demotion threshold:** sources with score < 0.5 are demoted from the allowlist
- **Demoted sources** are logged but no longer cited in new research. Existing citations remain but are flagged for review.

## Hybrid Approval Gate

The Orchestrator must respect this gate between Research and Discovery:

| `overall_confidence` | Behaviour |
|---------------------|-----------|
| `high` | Researcher output auto-merges. Discovery queues automatically. |
| `medium` | Researcher output requires **human approval** before Discovery may run. |
| `low` | Researcher output requires **human approval** before Discovery may run. |

Human approval means a human reviews the generated knowledge files and explicitly approves them in the DealFlow AI interface or via the MCP `approve_research` action.

## Insufficient-Sources Fallback Chain

When fewer than 2 useful sources are found in the initial web search:

1. **Web search across allowlist** — search each allowlisted domain for the activity name, activity ID, and scope item references
2. **In-app CBC help scrape** — if still < 2 useful sources, navigate to the activity in CBC, click the help icon (the `?` button), and capture the help panel content
3. **Emit `insufficient_sources` error** — if still < 2 sources after the fallback chain, pause the activity for human review. The Orchestrator blocks Discovery until a human provides sources or overrides.

## Output Files

For each researched activity, the Researcher writes three markdown files:

```
/knowledge/activities/<activity_id>/
  overview.md         — what the activity does, when to use it, prerequisites
  gotchas.md          — common mistakes, edge cases, order-of-operations issues
  test_data_recipes.md — sample data that exercises the activity's fields
```

Each file has YAML frontmatter validated by `schemas/knowledge-frontmatter.schema.json`.

### Cached sources

Raw source content is cached for re-runs:

```
/knowledge/sources/
  cached_help_pages/<activity_id>_<timestamp>.html
  cached_web_pages/<url_hash>_<timestamp>.html
```

These are gitignored (contents only — the directories are tracked).

## Uncertainty Markup

When sources conflict or coverage is thin, the Researcher injects an HTML comment:

```html
<!-- RESEARCHER UNCERTAIN: <description of what is uncertain> -->
```

These comments are:
- Parsed by the Researcher to populate `uncertainty_flags` in the output
- Surfaced to humans during the approval gate review
- Used by the Librarian to prioritize which knowledge needs verification

## Cost Target

- **Budget:** $2 per activity
- **Model:** Use Sonnet, not Opus
- **Caching:** Cache all fetched sources aggressively. Re-runs of the same activity should use cached sources and cost near-zero.
- **Reporting:** Actual cost is logged to the telemetry database and reported in `cost_usd` output.
