# DealFlow AI — Playwright Provisioning Runner

Local Node.js service that polls the BTP API for queued provisioning jobs and executes them via Playwright browser automation.

## Setup

```bash
cd ~/Projects/dealflow-ai-runner
npm install
npx playwright install chromium
```

## Configuration

Edit `config.js` or set environment variables:

```bash
export DEALFLOW_IAS_SECRET="your-ias-client-secret"
export DEALFLOW_RUNNER_USER="adam.lalor@sap.com"
export DEALFLOW_RUNNER_PASS="your-password"
```

## Usage

```bash
# Poll continuously (production mode)
npm start

# Check once and exit
npm run once

# Poll mode (same as start)
npm run poll
```

## How It Works

1. User Manager UI → click "Provision" → creates a job in HANA (status: queued)
2. This runner polls `/api/runner/jobs` for queued jobs
3. For each job, it fetches users, roles, and system connections
4. Executes 4 steps in order:
   - **S/4 Worker Upload** — uploads worker CSV to Manage Workforce
   - **S/4 Role Assignment** — uploads role CSV to Maintain Business Users
   - **IAS User Creation** — creates users in Identity Authentication (placeholder)
   - **CBC User Assignment** — assigns tagged users in CBC (placeholder)
5. Updates job/step status back to BTP after each step

## Step Status

- `pending` — waiting to run
- `running` — currently executing
- `completed` — finished successfully
- `failed` — error occurred (check error_message)
- `skipped` — no connection configured or no data needed

## Screenshots

Error screenshots are saved to `./screenshots/` automatically.
Set `headless: false` in config.js to watch the browser live.

## Architecture

```
User Manager UI (React on BTP)
    ↓ click "Provision"
    ↓ stores job in HANA (status: queued)
    
This Runner (Node.js on your Mac)
    ↓ polls BTP API for queued jobs
    ↓ runs headless Chromium via Playwright
    ↓ updates job status in HANA after each step
    
User Manager UI
    ↓ shows live progress per job
```
