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

## BTP Deployment (Cloud Foundry)

The runner runs on BTP Cloud Foundry as a no-route background worker. Chromium requires system libraries not present on cflinuxfs4 — these are bundled in `chromium-libs/` (extracted from the official Playwright Docker image for linux/amd64).

### How it works

1. `cf push` deploys the Node.js app with the `nodejs_buildpack`
2. `start-cf.sh` runs at startup:
   - Installs Playwright Chromium headless shell (`npx playwright install chromium`)
   - Sets `LD_LIBRARY_PATH` to include the bundled `chromium-libs/` directory
   - Starts `node runner.js` in poll mode
3. The runner polls the BTP API every 10 seconds for queued jobs

### Deploy commands

```bash
# Standard deploy (from runner repo root)
cd ~/Projects/dealflow-ai-runner
cf push dealflow-ai-runner

# Check logs
cf logs dealflow-ai-runner --recent

# SSH in to debug
cf ssh dealflow-ai-runner

# Restart
cf restart dealflow-ai-runner

# Check missing Chromium libs (via SSH)
cf ssh dealflow-ai-runner -c 'LD_LIBRARY_PATH=/home/vcap/app/chromium-libs ldd /home/vcap/app/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell 2>&1 | grep "not found"'
```

### CF Manifest (`manifest.yml`)

- **memory:** 1G (Chromium needs ~500MB at runtime)
- **disk_quota:** 2G (Playwright Chromium + bundled libs)
- **no-route:** true (background worker, no HTTP endpoint)
- **health-check-type:** process (not HTTP — no port to check)
- **command:** `bash start-cf.sh`
- **env:** `CF_RUNNER=true`, `HEADLESS=true`, `DEALFLOW_RUNNER_KEY`

### Bundled Chromium Libraries (`chromium-libs/`)

CF's cflinuxfs4 stack is missing libraries that Chromium needs. These `.so` files were extracted from `mcr.microsoft.com/playwright:v1.50.0-jammy` (linux/amd64):

```
libnspr4.so, libnss3.so, libnssutil3.so, libsoftokn3.so, libfreeblpriv3.so,
libnssckbi.so, libnssdbm3.so, libsmime3.so, libplc4.so, libplds4.so,
libatk-1.0.so.0, libatk-bridge-2.0.so.0, libatspi.so.0, libXcomposite.so.1,
libXdamage.so.1, libXrandr.so.2, libgbm.so.1, libxkbcommon.so.0,
libasound.so.2, libcups.so.2, libavahi-common.so.3, libavahi-client.so.3,
libdbus-1.so.3, libwayland-server.so.0, libsqlite3.so.0, libfreeblpriv3.so
```

### Updating bundled libs

If Playwright is upgraded and Chromium needs new libs:

```bash
# 1. Deploy and check which libs are missing
cf ssh dealflow-ai-runner -c 'export LD_LIBRARY_PATH=/home/vcap/app/chromium-libs; CHROME=$(find /home/vcap/app/.cache/ms-playwright -name "chrome-headless-shell" | head -1); ldd $CHROME 2>&1 | grep "not found"'

# 2. Extract missing libs from the Playwright Docker image
docker run --rm --platform linux/amd64 -v /tmp/libs:/out mcr.microsoft.com/playwright:v1.50.0-jammy bash -c "cp /usr/lib/x86_64-linux-gnu/libMISSING.so /out/"

# 3. Copy to chromium-libs/ and redeploy
cp /tmp/libs/*.so* ~/Projects/dealflow-ai-runner/chromium-libs/
cf push dealflow-ai-runner
```

### Runner Health Check

The BTP API exposes `GET /api/runner/health` (no auth required) which returns:

```json
{ "connected": true, "source": "btp", "last_poll": "2026-03-16T21:00:50Z", "age_seconds": 3 }
```

- **connected:** true if runner polled within the last 30 seconds
- **source:** `"btp"` (CF deployment) or `"local"` (Mac)
- The CBC Control Centre has a "Runner Status" button that calls this endpoint

---

*Last updated: March 2026*
