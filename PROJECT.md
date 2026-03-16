# ProjectFlow AI Runner — Project Guide

## Review & Cleanup Prompt

Same prompt as the main repo — see `dealflow-ai/PROJECT.md` for the full checklist.

## Overview

Browser automation system for SAP enterprise apps (S/4HANA Cloud, Cloud ALM, CBC) using Playwright + Claude Computer Use API as vision fallback.

- **Repo:** `projectflow-ai-runner`
- **Local path:** `/Users/i075199/Projects/dealflow-ai-runner/`
- **Start (headed):** `HEADLESS=false bash start.sh`
- **Start (headless):** `bash start.sh`
- **Polls:** BTP API at `dealflow-ai-api.cfapps.eu12-002.hana.ondemand.com`

## Architecture

```
HANA Job Queue → BTP API ← Runner (polls every 10s)
                              ├── Playwright (browser automation)
                              └── Computer Use API (vision fallback)
```

## Step Handlers

| Step Type | Script | Status |
|-----------|--------|--------|
| s4_worker_upload | scripts/s4-worker-upload.js | ✅ Working |
| s4_role_upload | scripts/s4-role-assignment.js | ✅ Working |
| ias_create | scripts/ias-create-users.js | ✅ Working (SCIM) |
| cbc_workspace_create | scripts/cbc-workspace-create.js | ✅ Working (deterministic) |

## Available Scripts (not yet wired as handlers)

| Script | Purpose |
|--------|---------|
| scripts/cbc-org-structure.js | Deterministic org structure creation (11 steps) |

## Key Patterns

### CBC Automation
- **All DOM interactions use `page.evaluate()`** — bypasses Playwright's stacked dialog pointer interception
- **Role-based selectors** (`getByRole`, `getByLabel`) from Playwright codegen recording for workspace setup
- **Checkbox clicks must use Playwright** (not evaluate) to trigger UI5 property bindings
- **Loading cards:** Poll `ui5-card[loading]` before clicking buttons on Overview page
- **Stacked dialogs:** CBC keeps multiple `ui5-dialog[open]` elements — always scope to topmost or specific `data-help-id`

### Computer Use Agent
- Model: `claude-sonnet-4-20250514`, tool type `computer_20250124`
- Viewport: 1024×768, screenshots trimmed to last 3 in conversation history
- Used as **fallback only** — deterministic selectors preferred
- Exponential backoff retry on 429/529 API errors

### Browser Management
- Browser closed between jobs (`closeBrowser()` after each `executeJob()`)
- Persistent profile at `~/.dealflow-runner-profile`
- Keys from macOS Keychain: `dealflow-runner-key`, `anthropic-api-key`

### API Communication
- Status updates retry 3x with backoff (lib/api.js `apiPatchWithRetry`)
- Runner authenticated via `x-runner-key` header

## File Structure

```
dealflow-ai-runner/
├── runner.js              # Main orchestrator (poll loop, step dispatch)
├── config.js              # Runtime config (headless, API URL, polling)
├── start.sh               # Start script (loads keys from Keychain)
├── lib/
│   ├── ai-agent.js        # Computer Use agent (vision fallback)
│   ├── api.js             # BTP API client (fetch jobs, update status)
│   └── browser.js         # Playwright browser/page management
├── scripts/
│   ├── s4-worker-upload.js
│   ├── s4-role-assignment.js
│   ├── ias-create-users.js
│   ├── cbc-workspace-create.js
│   └── cbc-org-structure.js
├── recordings/            # Playwright codegen recordings
├── screenshots/           # Runtime screenshots (gitignored)
└── PROJECT.md             # This file
```

---

*Last updated: March 2026*
