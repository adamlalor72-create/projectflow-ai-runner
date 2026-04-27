# 0001 — Repo Audit: dealflow-ai-runner

**Date:** 2026-04-27
**Author:** Architect Agent (Phase 0, Step 1)
**Status:** Awaiting human approval

---

## 1. Package Manager and Lockfile State

| Item | Value |
|------|-------|
| Package manager | **npm** |
| Lockfile | `package-lock.json` (lockfileVersion 3) |
| Node version (local) | v24.14.0 |
| npm version (local) | 11.9.0 |
| pnpm/yarn present | No (`pnpm-lock.yaml` and `yarn.lock` absent) |

The project has a single `package.json` at the root with one dependency (`playwright ^1.50.0`). `npm ci` works cleanly.

## 2. Monorepo / Workspace Status

**Not a workspaces monorepo.** The root `package.json` has no `"workspaces"` field. There is a `dealflow-ai-runner/` subdirectory that appears to be a stale copy of the repo (contains its own `runner.js`, `config.js`, `lib/`, `scripts/`, `screenshots/`, `recordings/`). It is listed in `.cfignore` and `.dockerignore`, so it's excluded from deployments. The active code lives at the repo root.

## 3. TypeScript Config and Version

**No TypeScript.** The project is 100% plain JavaScript (ES modules, `"type": "module"` in `package.json`). There is no `tsconfig.json`, no TypeScript dependency, and no `.ts` files outside `node_modules/`.

## 4. Test Framework

**No test framework.** There are no test files, no test dependencies (jest, vitest, mocha, etc.), and no test scripts beyond `"test-s4"` which is a manual integration script (`node scripts/s4-worker-upload.js --test`), not a unit test runner.

## 5. Lint and Format Setup

**None.** No `.eslintrc`, `.prettierrc`, `biome.json`, or similar config files. No lint/format dependencies in `package.json`.

## 6. CI Workflows

**None.** There is no `.github/` directory. No CI/CD pipeline definition exists in the repo. Deployment is manual (`cf push`).

## 7. Computer Use Agent Code

Located at **`lib/ai-agent.js`** (~477 lines). Uses the Anthropic Computer Use API (`computer_20250124` tool type) with `claude-sonnet-4-20250514` as the default model. Features:

- Screenshot-based control loop (screenshot -> Claude -> coordinate-based action -> repeat)
- CDP-based mouse input to bypass UI5 dialog overlay interception
- Credential injection for password fields
- Conversation history trimming (keep first + last 2 turn pairs)
- Rate limit handling with 30s backoff on 429

The learned-strategies system is at **`lib/learned-strategies.js`** (~180 lines) — after AI resolves a problem, it asks Claude to generate Playwright code from the action sequence and caches it for future runs.

## 8. Playwright Runner

Located at **`lib/browser.js`** (~408 lines). Manages browser lifecycle with:

- Persistent context on local (macOS profile at `~/.dealflow-runner-profile`)
- Ephemeral context on Cloud Foundry
- SAP UI5/Fiori helpers: `waitForUI5Ready`, `clickUI5Button`, `fillUI5Input`, `getUI5FileInput`
- Login handler with AI fallback
- Screenshot utility (local saves to `./screenshots/`, CF logs base64)

The main orchestrator is **`runner.js`** (~220 lines) — polls BTP API for queued provisioning jobs and dispatches to step handlers.

## 9. BTP Gen AI Hub Integration

**Not present.** The Anthropic API is called directly from `lib/ai-agent.js` using raw `fetch()` against `https://api.anthropic.com/v1/messages`. There is no SAP AI Core or Gen AI Hub SDK usage. The API key is fetched from the BTP backend (`/api/runner/ai-config`) or from the environment variable `ANTHROPIC_API_KEY`.

## 10. macOS Keychain Integration

Located in **`start.sh`** (lines 4-5):

```bash
export DEALFLOW_RUNNER_KEY="$(security find-generic-password -s 'dealflow-runner-key' -w 2>/dev/null)"
export ANTHROPIC_API_KEY="$(security find-generic-password -s 'anthropic-api-key' -w 2>/dev/null)"
```

Two keychain entries:
- `dealflow-runner-key` — shared API key for runner <-> BTP API auth
- `anthropic-api-key` — Anthropic API key for Computer Use agent

## 11. Cloud Foundry Deployment

**Manifest:** `manifest.yml` — deploys as a no-route background worker (`no-route: true`, `health-check-type: process`). 2G memory, 2G disk. Uses `nodejs_buildpack` with `bash start-cf.sh` as entrypoint.

**Kubernetes alternative:** `k8s-deployment.yml` — Docker-based Kyma deployment using `mcr.microsoft.com/playwright:v1.58.2-jammy` base image. Secrets from `dealflow-runner-secret`.

**Docker:** `Dockerfile` present, builds from Playwright base image.

**Chromium libs:** `chromium-libs/` directory (28 `.so` files) bundled for CF where cflinuxfs4 is missing Chromium dependencies.

**Deploy script:** `deploy-kyma.sh` for Kubernetes path.

---

## Decisions and Recommendations

### Decision 1: Convert to npm workspaces — YES

**Recommendation:** Add `"workspaces": ["packages/*"]` to the root `package.json`.

**Rationale:**
- The repo is a single-package flat layout today. Converting to npm workspaces is a one-line change (`"workspaces": ["packages/*"]`) with near-zero risk to existing code.
- Cartographer needs its own `package.json` with TypeScript, a test runner, and schema validation tooling. Keeping these as a workspace package gives clean dependency isolation while sharing the same `node_modules` tree.
- The existing DealFlow runner has *one* dependency (Playwright). There is no complex dependency graph to untangle.
- npm workspaces are natively supported by the npm version already in use (11.9.0 on Node 24).

**Migration cost:** Minimal. Add the workspaces field, run `npm install` to regenerate the lockfile. Existing `npm start` / `npm run poll` continue to work unchanged from root.

### Decision 2: Switch to pnpm — NO

**Recommendation:** Stay on npm.

**Rationale:**
- The existing setup is clean: one dependency, one lockfile, `npm ci` works. There is no dependency mess that pnpm's strictness would fix.
- The CF buildpack (`nodejs_buildpack`) uses npm natively. Switching to pnpm would require buildpack configuration changes, adding operational risk to the existing deployment for zero benefit.
- The Dockerfile uses `npm ci`. Switching means changing the Docker build.
- Cartographer can get everything it needs from npm workspaces.

### Decision 3: Where `/packages/cartographer/` fits

The Cartographer package will live at `/packages/cartographer/` as a new npm workspace. The existing DealFlow runner code stays exactly where it is at the repo root — it is **not** moved into a `packages/` directory. This means:

```
dealflow-ai-runner/           ← existing code, untouched
├── runner.js
├── config.js
├── lib/
├── scripts/
├── package.json              ← add "workspaces": ["packages/*"]
└── packages/
    └── cartographer/         ← NEW: Cartographer workspace
        ├── package.json
        ├── tsconfig.json
        ├── schemas/
        ├── contracts/
        ├── services/
        ├── knowledge/
        └── ...
```

The existing runner does not move. It does not become a workspace package. It continues to be the "root" project. Cartographer is the only workspace package. This minimizes changes to the existing codebase and deployment (CF manifest, Dockerfile, and all import paths remain unchanged).

### Note: Stale `dealflow-ai-runner/` subdirectory

The `dealflow-ai-runner/` subdirectory at the repo root appears to be a stale copy of the codebase from an earlier date (March 8-12, 2026). It is already excluded from CF and Docker deployments via `.cfignore` and `.dockerignore`. It should be deleted or gitignored, but this is outside the Architect Agent's write scope per the brief. Flagging for awareness.

---

**Awaiting human approval before proceeding to Step 2.**
