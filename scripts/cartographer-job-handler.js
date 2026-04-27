// DealFlow AI Runner — Cartographer Job Handler
// Bridges runner polling loop with Cartographer MCPServer services.
// Each job type maps to an MCPServer method; results are synced back to HANA.

import config from '../config.js';
import { loadConfig } from '../packages/cartographer/src/config.js';
import { resolveConfig } from '../packages/cartographer/src/btp-api.js';
import { createServices } from '../packages/cartographer/src/create-services.js';
import { launchBrowser, closeBrowser, loginToCBC } from '../packages/cartographer/src/browser.js';
import { wrapPage } from '../packages/cartographer/src/page-adapter-impl.js';

const BROWSER_REQUIRED = new Set(["discover", "verify", "load", "drift_check", "drift_all"]);

async function apiFetch(path, opts = {}) {
  const url = config.apiUrl + path;
  const headers = {
    "Content-Type": "application/json",
    "x-runner-key": config.runnerApiKey,
    "x-runner-source": config.isCloudFoundry ? "btp" : "local",
    ...opts.headers,
  };
  return fetch(url, { ...opts, headers });
}

async function patchJob(jobId, data) {
  const r = await apiFetch(`/api/runner/cartographer-job/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!r.ok) console.error(`[Cartographer] Failed to patch job ${jobId.slice(0, 8)}: ${r.status}`);
}

async function syncActivity(activityId, data) {
  const r = await apiFetch(`/api/runner/cartographer-activity/${activityId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!r.ok) console.error(`[Cartographer] Failed to sync activity ${activityId}: ${r.status}`);
}

export async function fetchCartographerJobs() {
  const r = await apiFetch("/api/runner/cartographer-jobs");
  if (!r.ok) {
    if (r.status !== 404) console.error("[Cartographer] Failed to fetch jobs:", r.status);
    return [];
  }
  return r.json();
}

async function executeCartographerJob(job) {
  const needsBrowser = BROWSER_REQUIRED.has(job.job_type);
  const rawConfig = loadConfig();
  const { config: cartoConfig, connection } = await resolveConfig(rawConfig);

  let browser = null;
  let context = null;
  let services = null;

  try {
    if (needsBrowser) {
      const launched = await launchBrowser(cartoConfig);
      browser = launched.browser;
      context = launched.context;
      const page = launched.page;

      if (connection) {
        await loginToCBC(page, connection);
      }

      const pageAdapter = wrapPage(page);
      services = createServices(cartoConfig, pageAdapter);
    } else {
      services = createServices(cartoConfig);
    }

    const params = job.params_json ? JSON.parse(job.params_json) : {};
    let result;

    switch (job.job_type) {
      case "research":
        result = await services.mcp.researchActivity({
          activity_id: job.activity_id,
          activity_name: params.activity_name,
        });
        break;

      case "discover":
        result = await services.mcp.discoverActivity({
          activity_id: job.activity_id,
          activity_name: params.activity_name,
        });
        break;

      case "verify":
        result = await services.mcp.verifyActivity({
          activity_id: job.activity_id,
          max_iterations: params.max_iterations,
        });
        break;

      case "load":
        result = await services.mcp.loadActivity({
          activity_id: job.activity_id,
          data: params.data || {},
          dry_run: params.dry_run,
        });
        break;

      case "drift_check":
        result = await services.mcp.diffActivity({
          activity_id: job.activity_id,
        });
        break;

      case "drift_all":
        if (!services.drift) throw new Error("Drift monitor requires a browser");
        const driftResults = await services.drift.checkAll();
        result = {
          total_checked: driftResults.length,
          drifted: driftResults.filter(r => r.result.has_drift).length,
          results: driftResults.map(r => ({
            activity_id: r.activity_id,
            has_drift: r.result.has_drift,
            signals_count: r.result.signals.length,
          })),
        };
        break;

      default:
        throw new Error(`Unknown cartographer job type: ${job.job_type}`);
    }

    return result;
  } finally {
    if (services) services.close();
    if (context) await closeBrowser(browser, context);
  }
}

function extractActivitySync(jobType, result) {
  const now = new Date().toISOString();
  const sync = { updated_at: now };

  switch (jobType) {
    case "research":
      sync.last_research_at = now;
      sync.lifecycle_phase = "researched";
      sync.knowledge_json = JSON.stringify({
        confidence: result.overall_confidence,
        files_written: result.files_written,
        sources_cited: result.sources_cited,
      });
      break;

    case "discover":
      sync.last_discover_at = now;
      sync.lifecycle_phase = "discovered";
      if (result.map) {
        sync.map_json = JSON.stringify(result.map);
        sync.fields_count = result.fields_found;
        sync.map_version = result.map.version || 1;
      }
      break;

    case "verify":
      sync.last_verify_at = now;
      sync.lifecycle_phase = result.passed ? "verified" : "discovered";
      sync.verified = result.passed;
      sync.map_version = result.map_version;
      break;

    case "load":
      if (result.success) {
        sync.lifecycle_phase = "production";
      }
      break;

    case "drift_check":
      sync.last_drift_check = now;
      sync.drift_status = result.has_drift ? "drifted" : "clean";
      if (result.has_drift) {
        sync.lifecycle_phase = "drifted";
      }
      break;
  }

  return sync;
}

export async function pollCartographerJobs() {
  let jobs;
  try {
    jobs = await fetchCartographerJobs();
  } catch (err) {
    return false;
  }

  if (!jobs || jobs.length === 0) return false;

  console.log(`[Cartographer] Found ${jobs.length} queued job(s)`);

  for (const job of jobs) {
    console.log(`\n[Cartographer] Executing ${job.job_type} for ${job.activity_id} (job ${job.id.slice(0, 8)})`);

    await patchJob(job.id, {
      status: "running",
      started_at: new Date().toISOString(),
    });

    try {
      const result = await executeCartographerJob(job);

      await patchJob(job.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        result_json: JSON.stringify(result),
        cost_usd: result.cost_usd || 0,
      });

      const activitySync = extractActivitySync(job.job_type, result);
      if (job.hana_activity_id) {
        await syncActivity(job.hana_activity_id, activitySync);
      }

      console.log(`[Cartographer] Job ${job.id.slice(0, 8)} completed`);
    } catch (err) {
      console.error(`[Cartographer] Job ${job.id.slice(0, 8)} failed:`, err.message);
      await patchJob(job.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: err.message,
      });
    }
  }

  return true;
}
