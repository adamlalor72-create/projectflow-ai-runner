# DealFlow AI — Playwright Provisioning Runner

> Automated user provisioning across S/4HANA Cloud, IAS, and CBC via Playwright browser automation.

---

## Table of Contents

1. [What the Runner Does](#1-what-the-runner-does)
2. [Architecture](#2-architecture)
3. [Repository Structure](#3-repository-structure)
4. [Environment Variables](#4-environment-variables)
5. [Running Locally](#5-running-locally)
6. [Running in Docker / Kyma](#6-running-in-docker--kyma)
7. [Switching Between Local and Kyma](#7-switching-between-local-and-kyma)
8. [Redeploying to Kyma](#8-redeploying-to-kyma)
9. [How Steps Work](#9-how-steps-work)
10. [AI Vision Agent Fallback](#10-ai-vision-agent-fallback)
11. [Screenshots](#11-screenshots)
12. [Monitoring & Logs](#12-monitoring--logs)
13. [Troubleshooting](#13-troubleshooting)
14. [Infrastructure Reference](#14-infrastructure-reference)

---

## 1. What the Runner Does

The Runner is a Node.js process that polls the DealFlow AI BTP API every 10 seconds for queued provisioning jobs. When a job is found, it executes up to three steps in sequence using a real Chromium browser (Playwright):

| Step | Type | System | What it does |
|------|------|--------|-------------|
| 1 | `s4_worker_upload` | S/4HANA | Creates worker record via CSV import in Manage Workforce |
| 2 | `s4_role_upload` | S/4HANA | Assigns business roles via CSV upload in Maintain Business Users |
| 3 | `ias_create` | IAS | Creates identity via SCIM API, assigns groups, sets initial password |

If any step fails, remaining steps are skipped and the job is marked `failed`. All step results, screenshots, and error details are written back to HANA via the BTP API.

---

## 2. Architecture

```
┌─────────────────────────────┐
│   DealFlow AI UI (React)    │
│   User Manager → Provision  │
└──────────────┬──────────────┘
               │ creates job in HANA
               ▼
┌─────────────────────────────┐
│   BTP API (CAP/Node.js)     │
│   /api/runner/jobs          │◄──── Runner polls every 10s
│   /api/runner/jobs/:id      │
│   /api/runner/jobs/:id/steps│
└──────────────┬──────────────┘
               │ job detail (users, roles, connections)
               ▼
┌─────────────────────────────┐
│   Playwright Runner         │
│   (local Mac or Kyma pod)   │
│                             │
│  ┌─────────────────────┐    │
│  │ Step 1: S4 Worker   │    │──► S/4HANA my2176413
│  │ Step 2: S4 Roles    │    │──► S/4HANA my2176413
│  │ Step 3: IAS Create  │    │──► IAS SCIM API
│  └─────────────────────┘    │
└─────────────────────────────┘
```

**Key design decisions:**
- The runner is intentionally kept off BTP CF (no persistent filesystem, port restrictions). It runs either locally on Mac or in a Kyma pod.
- Only **one runner instance** should run at a time. Both local and Kyma poll the same job queue — running both simultaneously will cause double-execution.
- The BTP API acts as the queue and state store. The runner is stateless — it can be restarted at any time.

---

## 3. Repository Structure

```
dealflow-ai-runner/
├── runner.js                  # Main entry point — poll loop and job orchestrator
├── config.js                  # Environment detection, all config in one place
├── package.json
├── Dockerfile                 # Kyma/Docker image (playwright:v1.58.2-jammy base)
├── k8s-deployment.yml         # Kubernetes deployment manifest for Kyma
├── deploy-kyma.sh             # Full build → push → deploy script
├── lib/
│   ├── api.js                 # BTP API client (fetchQueuedJobs, updateJob, updateStep)
│   ├── browser.js             # Playwright browser manager + SAP UI5 helpers
│   └── ai-agent.js            # AI Vision Agent fallback (screenshot → Claude → action)
└── scripts/
    ├── s4-worker-upload.js    # Step 1: Manage Workforce CSV import
    ├── s4-role-assignment.js  # Step 2: Maintain Business Users role CSV upload
    └── ias-create-users.js    # Step 3: IAS SCIM provisioning
```

---

## 4. Environment Variables

| Variable | Where set | Description |
|----------|-----------|-------------|
| `DEALFLOW_RUNNER_KEY` | Mac shell / Kyma secret | Shared API key — must match `RUNNER_API_KEY` on BTP API server |
| `CF_RUNNER` | `k8s-deployment.yml` → `"true"` | Switches to headless mode and `/tmp` screenshot storage |
| `HEADLESS` | Optional | Set to `"false"` locally to watch the browser. Ignored on CF. |
| `NODE_ENV` | `k8s-deployment.yml` → `"production"` | Standard Node env flag |

**The runner never needs S/4 or IAS credentials directly** — it fetches them from the BTP API via `/api/runner/jobs/:id` which reads them from HANA System Connections.

### Setting the runner key locally

```bash
export DEALFLOW_RUNNER_KEY="2fa0bbe5f1c820668e7a6d25e09d3d05ec1ffd82685764a6cfd3d2b57abddee0"
```

Add to `~/.zshrc` to persist across sessions.

---

## 5. Running Locally

### Prerequisites

- Node.js 18+
- Playwright with Chromium installed
- `DEALFLOW_RUNNER_KEY` exported in your shell

### First-time setup

```bash
cd ~/Projects/dealflow-ai-runner
npm install
npx playwright install chromium
```

### Start polling

```bash
# Continuous poll (every 10s)
node runner.js

# Process one job and exit
node runner.js --once

# Watch the browser (non-headless)
HEADLESS=false node runner.js
```

### Local behaviour

- Screenshots save to `./screenshots/` as `.png` files
- Browser runs with `slowMo: 100` (slight delay between actions — good for debugging)
- A persistent Chromium profile is stored at `~/.dealflow-runner-profile` so cert selections survive restarts

---

## 6. Running in Docker / Kyma

### Docker image

The image is based on `mcr.microsoft.com/playwright:v1.58.2-jammy` which includes all Chromium dependencies pre-installed. No `npx playwright install` needed inside the container.

**Important:** Always build for `linux/amd64`. Mac M-series chips are `arm64` but Kyma nodes are `amd64`. Using the wrong architecture causes a silent failure at runtime.

```bash
# Correct — explicit platform
docker buildx build --platform linux/amd64 -t adamlalor72/dealflow-ai-runner:latest --push .

# Wrong — will build arm64 on M-series Mac
docker build -t adamlalor72/dealflow-ai-runner:latest .
```

### Kyma cluster details

| Field | Value |
|-------|-------|
| Cluster name | `dealflow-ai-bch3smu3` |
| Plan | Free (expires 30 days from provisioning) |
| Region | AWS eu-central-1 |
| API server | `https://api.a0450a3.stage.kyma.ondemand.com` |
| Dashboard | `https://dashboard.stage.kyma.cloud.sap/?kubeconfigID=9A5C6134-BE6D-4A6F-AE73-0FF2D9F1E5C9` |
| Kubeconfig | `~/Downloads/kubeconfig.yaml` |
| Docker Hub | `adamlalor72/dealflow-ai-runner:latest` |

### Kubernetes secret

The runner API key is stored as a Kubernetes secret and injected as an env var:

```bash
kubectl create secret generic dealflow-runner-secret \
  --from-literal=runner-api-key="2fa0bbe5f1c820668e7a6d25e09d3d05ec1ffd82685764a6cfd3d2b57abddee0"
```

This only needs to be run once (or when the key changes). The `k8s-deployment.yml` references it via `secretKeyRef`.

### Chromium `/dev/shm` requirement

Chromium requires a larger shared memory segment than the Kubernetes default (64MB). The deployment manifest mounts a `512Mi` in-memory volume at `/dev/shm`:

```yaml
volumeMounts:
  - mountPath: /dev/shm
    name: dshm
volumes:
  - name: dshm
    emptyDir:
      medium: Memory
      sizeLimit: 512Mi
```

Without this, Chromium crashes silently on complex SAP Fiori pages.

---

## 7. Switching Between Local and Kyma

> ⚠️ Never run both at the same time. Both poll the same job queue.

### Stop Kyma, start local

```bash
export KUBECONFIG=~/Downloads/kubeconfig.yaml
kubectl scale deployment/dealflow-ai-runner --replicas=0

# Then start locally
cd ~/Projects/dealflow-ai-runner
node runner.js
```

### Stop local, start Kyma

Stop the local process (`Ctrl+C`), then:

```bash
export KUBECONFIG=~/Downloads/kubeconfig.yaml
kubectl scale deployment/dealflow-ai-runner --replicas=1

# Confirm it's running
kubectl get pods
kubectl logs -f deployment/dealflow-ai-runner
```

### Check which is currently running

```bash
# Check Kyma
export KUBECONFIG=~/Downloads/kubeconfig.yaml
kubectl get pods

# If READY 1/1 → Kyma runner is active
# If 0/0 or no pods → Kyma is scaled down
```

---

## 8. Redeploying to Kyma

Run this whenever you change any runner code:

```bash
export KUBECONFIG=~/Downloads/kubeconfig.yaml
cd ~/Projects/dealflow-ai-runner

# Build new image (--no-cache if you changed a file and the layer was cached)
docker buildx build --no-cache --platform linux/amd64 \
  -t adamlalor72/dealflow-ai-runner:latest --push .

# Restart the deployment to pull the new image
kubectl rollout restart deployment/dealflow-ai-runner
kubectl rollout status deployment/dealflow-ai-runner

# Tail logs to confirm
kubectl logs -f deployment/dealflow-ai-runner
```

> **Why `--no-cache`?** Docker caches the `COPY . .` layer. If you change a `.js` file but not `package.json`, the cache may be reused and the old code deployed. Use `--no-cache` to be safe after code changes.

### Update just the Playwright base image version

Edit `Dockerfile` line 1:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.58.2-jammy
```

Replace the version to match whatever `npx playwright --version` reports locally. Then rebuild and redeploy.

---

## 9. How Steps Work

### Step execution flow

```
runner.js polls API
  → fetchQueuedJobs()
  → fetchJobDetail(jobId)        ← gets users, roles, ias_groups, connections
  → updateJob(status: "running")
  → for each step:
      → updateStep(status: "running")
      → handler(job, step, users, roles, ias_groups, connection)
      → updateStep(status: "completed" | "failed")
  → updateJob(status: "completed" | "failed")
```

### Step handlers

Each script in `scripts/` exports a single async function:

```js
export async function runS4WorkerUpload({ job, step, users, roles, ias_groups, connection }) { ... }
export async function runS4RoleAssignment({ job, step, users, roles, ias_groups, connection }) { ... }
export async function runIasCreateUsers({ job, step, users, roles, ias_groups, connection }) { ... }
```

`connection` contains the system URL, username, and password fetched from HANA System Connections.

### Adding a new step type

1. Create `scripts/your-step.js` exporting the handler function
2. Add to `STEP_HANDLERS` in `runner.js`:
   ```js
   const STEP_HANDLERS = {
     s4_worker_upload: runS4WorkerUpload,
     s4_role_upload: runS4RoleAssignment,
     ias_create: runIasCreateUsers,
     your_step: runYourStep,        // ← add here
   };
   ```
3. Add the step to `FULL_STEPS` in `runner.js` if it should run for all full provisioning jobs

### Wait strategy

Scripts use `page.waitForLoadState("networkidle")` rather than hardcoded `waitForTimeout` delays. This resolves as soon as S/4 stops making network requests, making execution as fast as the server allows. The fallback `waitForUI5Ready()` checks that the SAP UI5 busy indicator has cleared.

---

## 10. AI Vision Agent Fallback

`lib/ai-agent.js` implements a vision-based fallback that activates when normal Playwright strategies fail. It:

1. Takes a screenshot of the current browser state
2. Sends it to Claude claude-sonnet-4-20250514 with a task description and page text
3. Parses the response as a structured action (`click`, `fill`, `navigate`, `wait`, `done`, `error`)
4. Executes the action and repeats (up to 8 attempts by default)

### When it activates

The `withAIFallback(page, fn, taskDescription, options)` wrapper in each script tries the normal Playwright code first. Only if that throws does the AI agent take over.

In a typical successful run the AI is **not called** — all SAP UI5 interactions succeed via direct strategies (control registry → getByRole → text locator → position).

### AI model and key

The runner fetches the Anthropic API key from the BTP API at startup via `/api/runner/ai-config`. It never needs to be set as an env var on the runner itself.

---

## 11. Screenshots

### Local mode

Screenshots save to `./screenshots/` as timestamped PNG files:

```
screenshots/
  s4-worker-manage-workforce_2026-03-11T12-52-24-201Z.png
  s4-worker-after-import_2026-03-11T12-52-40-878Z.png
  ...
```

### Kyma / Docker mode

Screenshots are saved to `/tmp/screenshots/` inside the container (readable within the same process) and also base64-encoded and written to stdout so they're retrievable from logs.

To extract a screenshot from logs:

```bash
export KUBECONFIG=~/Downloads/kubeconfig.yaml
kubectl logs deployment/dealflow-ai-runner --tail=500 | \
  grep "SCREENSHOT:s4-worker-after-import" | \
  sed 's/.*base64,//' | \
  base64 --decode > ~/Desktop/screenshot.png
```

---

## 12. Monitoring & Logs

### Tail live logs (Kyma)

```bash
export KUBECONFIG=~/Downloads/kubeconfig.yaml
kubectl logs -f deployment/dealflow-ai-runner
```

### Filter out base64 screenshot noise

```bash
kubectl logs deployment/dealflow-ai-runner --tail=200 | \
  grep -v "data:image/png" | grep -v "^\[SCREENSHOT"
```

### Useful log patterns to watch for

| Pattern | Meaning |
|---------|---------|
| `[Runner] Found 1 queued job(s)` | Job picked up |
| `[Runner] Step 1 completed.` | Worker upload done |
| `[Runner] Step 2 completed.` | Role upload done |
| `[Runner] Step 3 completed.` | IAS creation done |
| `[Runner] Job ... COMPLETED` | All steps succeeded |
| `[Runner] Step N failed:` | Step error — check message |
| `[AI Agent] Attempt 1/8` | AI fallback activated |
| `[Browser] Clicked UI5 Button (control registry)` | Fastest UI5 strategy |
| `[Browser] Clicked UI5 Button (getByRole)` | Fallback strategy (normal) |

### Check pod status

```bash
kubectl get pods
kubectl describe pod <pod-name>   # for crash/OOM diagnosis
```

---

## 13. Troubleshooting

### "Executable doesn't exist at /ms-playwright/chromium..."

The local Playwright version doesn't match the Docker image version. Fix:

1. Check local version: `node -e "const p = require('./node_modules/playwright/package.json'); console.log(p.version)"`
2. Update `Dockerfile` line 1 to match: `FROM mcr.microsoft.com/playwright:v1.XX.X-jammy`
3. Rebuild: `docker buildx build --no-cache --platform linux/amd64 -t adamlalor72/dealflow-ai-runner:latest --push .`
4. Redeploy: `kubectl rollout restart deployment/dealflow-ai-runner`

### "ENOENT: no such file or directory, open '[logged:ai-agent-attempt-1...]'"

The screenshot function returned a `[logged:...]` string instead of a real path, and the AI agent tried to `readFile` it. This was a bug that has been fixed — the screenshot now saves to `/tmp/screenshots/` in all environments.

### Job stuck in "running" status

The runner crashed mid-job. Manually reset the job status via the API or directly in HANA, then retrigger from the UI.

### Pod keeps restarting (CrashLoopBackOff)

```bash
kubectl describe pod <pod-name>   # look at Events section
kubectl logs <pod-name> --previous  # logs from crashed instance
```

Common causes: out of memory (OOM) on complex pages — increase memory limit in `k8s-deployment.yml`.

### Kubeconfig expired / authentication error

The kubeconfig at `~/Downloads/kubeconfig.yaml` uses a session token tied to your SAP SSO session. When it expires:

1. Go to the Kyma Dashboard: `https://dashboard.stage.kyma.cloud.sap/?kubeconfigID=9A5C6134-BE6D-4A6F-AE73-0FF2D9F1E5C9`
2. Download a fresh kubeconfig
3. Save to `~/Downloads/kubeconfig.yaml`

> For a permanent solution, create a Kubernetes service account with a long-lived token (required before production use).

### S/4 login not completing

S/4HANA Cloud redirects through IAS for authentication, which can cause timing issues. The login function retries up to 5 times with 1.5s delays. If it consistently fails, the AI agent will take over for the login step. Check that the S/4 system connection credentials in DealFlow AI are correct.

---

## 14. Infrastructure Reference

### BTP endpoints

| Service | URL |
|---------|-----|
| DealFlow AI app | `https://dealflow-ai.cfapps.eu12-002.hana.ondemand.com` |
| DealFlow AI API | `https://dealflow-ai-api.cfapps.eu12-002.hana.ondemand.com` |
| CF API | `https://api.cf.eu12-002.hana.ondemand.com` |
| IAS tenant | `https://aqlcnhyaq.accounts400.ondemand.com` |
| S/4 test tenant | `https://my2176413.lab.s4hana.cloud.sap` |

### Runner API key

```
2fa0bbe5f1c820668e7a6d25e09d3d05ec1ffd82685764a6cfd3d2b57abddee0
```

This must match the `RUNNER_API_KEY` environment variable on the `dealflow-ai-api` CF app.

### Kyma cluster

| Field | Value |
|-------|-------|
| Environment Instance ID | `9A5C6134-BE6D-4A6F-AE73-0FF2D9F1E5C9` |
| Cluster node | `ip-10-250-10-195.eu-central-1.compute.internal` |
| Docker Hub image | `adamlalor72/dealflow-ai-runner:latest` |
| Kubernetes secret | `dealflow-runner-secret` → key `runner-api-key` |

### GitHub

| Repo | URL |
|------|-----|
| Runner | `https://github.com/adamlalor72-create/projectflow-ai-runner` (public) |
| Main app | `https://github.com/adamlalor72-create/projectflow-ai` (private) |
