#!/usr/bin/env node
// DealFlow AI Runner — Main orchestrator
// Polls BTP for queued provisioning jobs and executes them via Playwright

import config from './config.js';
import { fetchQueuedJobs, fetchJobDetail, updateJob, updateStep } from './lib/api.js';
import { closeBrowser } from './lib/browser.js';
import { runS4WorkerUpload } from './scripts/s4-worker-upload.js';
import { runS4RoleAssignment } from './scripts/s4-role-assignment.js';
import { runIasCreateUsers } from './scripts/ias-create-users.js';


const args = process.argv.slice(2);
const MODE = args.includes("--once") ? "once" : "poll";

// Step type → script mapping
const STEP_HANDLERS = {
  s4_worker_upload: runS4WorkerUpload,
  s4_role_upload: runS4RoleAssignment,
  ias_create: runIasCreateUsers,
};

// Full provisioning creates 3 steps
const FULL_STEPS = [
  { order: 1, type: "s4_worker_upload" },
  { order: 2, type: "s4_role_upload" },
  { order: 3, type: "ias_create" },
];

async function executeJob(jobId) {
  console.log("\n══════════════════════════════════════════════════");
  console.log(`[Runner] Executing job: ${jobId}`);
  console.log("══════════════════════════════════════════════════");

  // Mark job as running
  await updateJob(jobId, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: 0,
  });

  let detail;
  try {
    detail = await fetchJobDetail(jobId);
  } catch (err) {
    console.error("[Runner] Failed to fetch job detail:", err.message);
    await updateJob(jobId, { status: "failed", error_message: err.message });
    return;
  }

  const { job, steps, users, roles, ias_groups, connections } = detail;
  console.log(`[Runner] Job type: ${job.job_type}, Users: ${users.length}, Steps: ${steps.length}`);
  console.log(`[Runner] Connections: ${Object.keys(connections).join(", ") || "none"}`);
  if (ias_groups?.length) console.log(`[Runner] IAS group assignments: ${ias_groups.length}`);
  if (users.length === 0) {
    await updateJob(jobId, { status: "failed", error_message: "No users to provision" });
    return;
  }

  // Execute each step in order
  let failed = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const handler = STEP_HANDLERS[step.step_type];

    if (!handler) {
      console.warn(`[Runner] No handler for step type: ${step.step_type}, skipping`);
      await updateStep(step.id, { status: "skipped" });
      continue;
    }

    // Check if the required system connection exists
    const requiredSystem = step.step_type.startsWith("s4_") ? "s4"
      : step.step_type.startsWith("ias_") ? "ias"
      : step.step_type.startsWith("cbc_") ? "cbc" : null;

    if (requiredSystem && !connections[requiredSystem]) {
      console.warn(`[Runner] No ${requiredSystem} connection configured, skipping step`);
      await updateStep(step.id, {
        status: "skipped",
        detail: JSON.stringify({ reason: `No ${requiredSystem} connection configured` }),
      });
      continue;
    }

    // Execute the step
    console.log(`\n── Step ${step.step_order}: ${step.step_type} ──`);
    await updateStep(step.id, {
      status: "running",
      started_at: new Date().toISOString(),
    });

    try {
      const result = await handler({
        job,
        step,
        users,
        roles,
        ias_groups,
        connection: connections[requiredSystem],
      });

      await updateStep(step.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        detail: JSON.stringify(result || {}),
      });
      console.log(`[Runner] Step ${step.step_order} completed.`);
    } catch (err) {
      console.error(`[Runner] Step ${step.step_order} failed:`, err.message);
      await updateStep(step.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: err.message,
        detail: JSON.stringify({ error: err.message, stack: err.stack }),
      });
      failed = true;
      // Stop execution — skip remaining steps
      for (let j = i + 1; j < steps.length; j++) {
        await updateStep(steps[j].id, {
          status: "skipped",
          detail: JSON.stringify({ reason: `Skipped — previous step (${step.step_type}) failed` }),
        });
        console.log(`[Runner] Step ${steps[j].step_order} (${steps[j].step_type}) skipped due to prior failure.`);
      }
      break;
    }

    // Update job progress
    const progress = Math.round(((i + 1) / steps.length) * 100);
    await updateJob(jobId, { progress });
  }

  // Mark job as completed or failed
  await updateJob(jobId, {
    status: failed ? "failed" : "completed",
    completed_at: new Date().toISOString(),
    progress: 100,
    error_message: failed ? "One or more steps failed — check step details" : null,
  });

  console.log(`\n[Runner] Job ${jobId} ${failed ? "FAILED" : "COMPLETED"}`);
}

async function pollOnce() {
  try {
    const jobs = await fetchQueuedJobs();
    if (jobs.length === 0) return false;

    console.log(`[Runner] Found ${jobs.length} queued job(s)`);
    for (const job of jobs) {
      await executeJob(job.id);
    }
    return true;
  } catch (err) {
    console.error("[Runner] Poll error:", err.message);
    return false;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   DealFlow AI — Playwright Provisioning Runner  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Mode: ${MODE}`);
  console.log(`API: ${config.apiUrl}`);
  console.log(`Headless: ${config.browser.headless}`);
  console.log("");

  if (MODE === "once") {
    const found = await pollOnce();
    if (!found) console.log("[Runner] No queued jobs found.");
    await closeBrowser();
    process.exit(0);
  }

  // Poll loop
  console.log(`[Runner] Polling every ${config.pollIntervalMs / 1000}s...`);
  while (true) {
    await pollOnce();
    await new Promise(r => setTimeout(r, config.pollIntervalMs));
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Runner] Shutting down...");
  await closeBrowser();
  process.exit(0);
});

main().catch(err => {
  console.error("[Runner] Fatal error:", err);
  process.exit(1);
});
