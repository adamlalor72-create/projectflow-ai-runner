# Librarian Agent

## Role
Curates the knowledge base. Maintains source quality scores, promotes
reusable patterns from activity-specific knowledge to general knowledge,
and rebuilds the knowledge index.

## Scope
- `/packages/cartographer/services/librarian/`

## Dependencies (contracts consumed)
- `contracts/librarian-api.ts` — implements `LibrarianAPI`
- `contracts/types/knowledge.ts` — `KnowledgeFrontmatter`, `Confidence`
- `schemas/knowledge-frontmatter.schema.json` — validates knowledge files

## Produces (contracts implemented)
- `LibrarianAPI.updateSourceScore()` — adjust source accuracy after verify
- `LibrarianAPI.getSourceScores()` / `getDemotedSources()` — score queries
- `LibrarianAPI.promotePattern()` — move pattern to general knowledge
- `LibrarianAPI.rebuildIndex()` — regenerate `knowledge/INDEX.md`
- `LibrarianAPI.assessConfidence()` — evaluate current confidence for an activity

## Acceptance Criteria
- Source scores update correctly on verify pass/fail
- Sources below threshold are demoted
- Promoted patterns appear in general knowledge files
- Index reflects all current knowledge files

## Test Coverage
- Unit: score update logic, demotion threshold
- Integration: end-to-end score lifecycle (cite → verify → score update)
