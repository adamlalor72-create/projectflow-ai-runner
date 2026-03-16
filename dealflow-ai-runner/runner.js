#!/usr/bin/env node
// ProjectFlow AI Runner — Main orchestrator
// Polls BTP for queued provisioning jobs and playbook jobs, executes via Playwright

import config from './config.js';
import { fetchQueuedJobs, fetchJobDetail, updateJob, updateStep,
         fetchPlaybook, updatePlaybookStep, updatePlaybook as updatePlaybookAPI } from './lib/api.js';
import { closeBrowser } from './lib/browser.js';
import { runS4WorkerUpload } from './scripts/s4-worker-upload.js';
import { runS4RoleAssignment } from './scripts/s4-role-assignment.js';
import { runIasCreateUsers } from './scripts/ias-create-users.js';
import { executePlaybook } from './scripts/playbook-executor.js';

const args = process.argv.slice(2);
const MODE = args.includes("--once") ? "once" : "poll";

// Step type -> script mapping (provisioning jobs)
const STEP_HANDLERS = {
  s4_worker_upload: runS4WorkerUpload,
  s4_role_upload: runS4RoleAssignment,
  ias_create: runIasCreateUsers,
};

const FULL_STEPS = [
  { order: 1, type: "s4_worker_upload" },
  { order: 2, type: "s4_role_upload" },
  { order: 3, type: "ias_create" },
];

// ── Playbook Job Execution ───────────────────────────────────
async function executePlaybookJob(jobId, job) {
  console.log("\n══════════════════════════════════════════════════");
  console.log(`[Runner] Executing PLAYBOOK job: ${jobId}`);
  console.log("══════════════════════════════════════════════════");

  await updateJob(jobId, { status: "running", started_at: new Date().toISOString(), progress: 0 });

  try {
    // Extract playbook ID from job config
    const jobConfig = typeof job.config === "string" ? JSON.parse(job.config) : (job.config || {});
    const playbookId = jobConfig.playbook_id;
    if (!playbookId) throw new Error("No playbook_id in job config");

    // Fetch playbook with steps, connection, and source data
    const { playbook, steps, connection, sourceData } = await fetchPlaybook(playbookId);
    if (!connection) throw new Error(`No ${playbook.system_type} connection configured`);
    if (!steps.length) throw new Error("Playbook has no steps");

    console.log(`[Runner] Playbook: ${playbook.name} (${steps.length} steps)`);
    console.log(`[Runner] System: ${playbook.system_type} | Data source: ${playbook.data_source || "none"}`);

    await updateJob(jobId, { progress: 10 });

    // Execute the playbook
    const result = await executePlaybook({
      playbook, steps, connection, sourceData,
      updateStep: updatePlaybookStep,
      updatePlaybook: updatePlaybookAPI,
    });

    await updateJob(jobId, {
      status: result.failed_steps > 0 ? "failed" : "completed",
      completed_at: new Date().toISOString(),
      progress: 100,
      error_message: result.failed_steps > 0 ? `${result.failed_steps}/${result.total_steps} steps failed` : null,
    });

    console.log(`[Runner] Playbook job ${jobId} ${result.failed_steps === 0 ? "COMPLETED" : "PARTIAL"}`);
  } catch (err) {
    console.error("[Runner] Playbook job failed:", err.message);
    await updateJob(jobId, { status: "failed", completed_at: new Date().toISOString(), error_message: err.message });
  }
}

// ── Provisioning Job Execution ───────────────────────────────
async function executeProvisioningJob(jobId) {
  console.log("\n══════════════════════════════════════════════════");
  console.log(`[Runner] Executing PROVISIONING job: ${jobId}`);
  console.log("══════════════════════════════════════════════════");

  await updateJob(jobId, { status: "running", started_at: new Date().toISOString(), progress: 0 });

  let detail;
  try {
    detail = await fetchJobDetail(jobId);
  } catch (err) {
    console.error("[Runner] Failed to fetch job detail:", err.message);
    await updateJob(jobId, { status: "failed", error_message: err.message });
    return;
  }

  const { job, steps, users, roles, connections } = detail;
  console.log(`[Runner] Users: ${users.length}, Steps: ${steps.length}`);

  if (users.length === 0) {
    await updateJob(jobId, { status: "failed", error_message: "No users to provision" });
    return;
  }

  let failed = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const handler = STEP_HANDLERS[step.step_type];

    if (!handler) {
      console.warn(`[Runner] No handler for: ${step.step_type}, skipping`);
      await updateStep(step.id, { status: "skipped" });
      continue;
    }

    const sys = step.step_type.startsWith("s4_") ? "s4" : step.step_type.startsWith("ias_") ? "ias" : null;
    if (sys && !connections[sys]) {
      await updateStep(step.id, { status: "skipped", detail: JSON.stringify({ reason: `No ${sys} connection` }) });
      continue;
    }

    console.log(`\n── Step ${step.step_order}: ${step.step_type} ──`);
    await updateStep(step.id, { status: "running", started_at: new Date().toISOString() });

    try {
      const result = await handler({ job, step, users, roles, connection: connections[sys] });
      await updateStep(step.id, { status: "completed", completed_at: new Date().toISOString(), detail: JSON.stringify(result || {}) });
    } catch (err) {
      console.error(`[Runner] Step failed:`, err.message);
      await updateStep(step.id, { status: "failed", completed_at: new Date().toISOString(), error_message: err.message });
      failed = true;
    }

    await updateJob(jobId, { progress: Math.round(((i + 1) / steps.length) * 100) });
  }

  await updateJob(jobId, { status: failed ? "failed" : "completed", completed_at: new Date().toISOString(), progress: 100, error_message: failed ? "One or more steps failed" : null });
}

// ── Main Loop ────────────────────────────────────────────────
async function pollOnce() {
  try {
    const jobs = await fetchQueuedJobs();
    if (jobs.length === 0) return false;

    console.log(`[Runner] Found ${jobs.length} queued job(s)`);
    for (const job of jobs) {
      if (job.job_type === "playbook") {
        await executePlaybookJob(job.id, job);
      } else {
        await executeProvisioningJob(job.id);
      }
    }
    return true;
  } catch (err) {
    console.error("[Runner] Poll error:", err.message);
    return false;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   ProjectFlow AI — Playwright Provisioning Runner   ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`Mode: ${MODE} | API: ${config.apiUrl} | Headless: ${config.browser.headless}\n`);

  if (MODE === "once") {
    const found = await pollOnce();
    if (!found) console.log("[Runner] No queued jobs found.");
    await closeBrowser();
    process.exit(0);
  }

  console.log(`[Runner] Polling every ${config.pollIntervalMs / 1000}s...`);
  while (true) {
    await pollOnce();
    await new Promise(r => setTimeout(r, config.pollIntervalMs));
  }
}

process.on("SIGINT", async () => { console.log("\n[Runner] Shutting down..."); await closeBrowser(); process.exit(0); });
main().catch(err => { console.error("[Runner] Fatal error:", err); process.exit(1); });
