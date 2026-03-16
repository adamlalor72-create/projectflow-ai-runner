// ProjectFlow AI Runner — Generic Playbook Executor
// Executes a playbook step by step. Tries learned sub-steps first (from recordings),
// falls back to AI Vision agent if sub-steps fail or don't exist.

import {
  newPage, loginToSystem, waitForUI5Ready, screenshot
} from '../lib/browser.js';
import { aiResolve } from '../lib/ai-agent.js';
import { runCbcOrgStructure } from './cbc-org-structure.js';

// Script handlers — called when step instruction starts with [SCRIPT:name]
const SCRIPT_HANDLERS = {
  'cbc-org-structure': runCbcOrgStructure,
};

/**
 * Resolve {placeholder} tokens in text using data context.
 */
function resolveBindings(text, bindings, context) {
  if (!bindings || !text) return text;
  const bindObj = typeof bindings === "string" ? JSON.parse(bindings) : bindings;
  let resolved = text;
  for (const [ph, path] of Object.entries(bindObj)) {
    let val = "";
    try {
      let cur = context;
      for (const p of path.split(".")) cur = cur?.[p];
      val = cur ?? "";
    } catch {}
    resolved = resolved.replace(new RegExp(`\\{${ph}\\}`, "g"), String(val));
  }
  return resolved;
}

/**
 * Resolve placeholders in sub-step values.
 */
function resolveSubStepValue(val, context) {
  if (!val || !val.includes("{")) return val;
  return val.replace(/\{(\w+)\}/g, (_, key) => {
    // Check sourceData first, then connection
    return context.sourceData?.[key] || context.connection?.[key] || val;
  });
}

/**
 * Execute a single recorded sub-step on the page.
 * Handles UI5 Web Components (ui5-button, ui5-select, etc).
 */
async function execSubStep(page, step, context) {
  const target = resolveSubStepValue(step.target || "", context);
  const value = resolveSubStepValue(step.value || "", context);
  const id = step.id || "";

  switch (step.action) {
    case "click": {
      // Strategy 1: By element ID (most reliable)
      if (id) {
        // Try exact ID
        let el = page.locator(`#${id}`);
        if (await el.count() > 0 && await el.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await el.first().click({ timeout: 10000 });
          console.log(`[SubStep] Clicked #${id}`);
          return true;
        }
        // Try ID prefix match (CBC generates dynamic suffixes)
        el = page.locator(`[id^="${id}"]`);
        if (await el.count() > 0) {
          await el.first().click({ timeout: 10000 });
          console.log(`[SubStep] Clicked [id^=${id}]`);
          return true;
        }
      }

      // Strategy 2: By tag + text (for ui5-button, ui5-option etc)
      if (step.tag) {
        const el = page.locator(`${step.tag}:has-text("${target}")`).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          await el.click({ timeout: 10000 });
          console.log(`[SubStep] Clicked ${step.tag} "${target}"`);
          return true;
        }
      }

      // Strategy 3: Text match (broad)
      const textEl = page.locator(`text="${target}"`).first();
      if (await textEl.isVisible({ timeout: 3000 }).catch(() => false)) {
        await textEl.click({ timeout: 10000 });
        console.log(`[SubStep] Clicked text "${target}"`);
        return true;
      }

      // Strategy 4: Button with text
      for (const sel of ['ui5-button', 'button', '[role="button"]']) {
        const btn = page.locator(`${sel}:has-text("${target}")`).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click({ timeout: 10000 });
          console.log(`[SubStep] Clicked ${sel} "${target}"`);
          return true;
        }
      }

      // Strategy 5: Broad text match (last resort)
      const broad = page.locator(`*:has-text("${target}")`).last();
      if (await broad.isVisible({ timeout: 2000 }).catch(() => false)) {
        await broad.click({ timeout: 10000 });
        console.log(`[SubStep] Clicked broad "${target}"`);
        return true;
      }

      console.warn(`[SubStep] Could not find: "${target}" (id: ${id})`);
      return false;
    }

    case "type": {
      let input = null;
      // By ID
      if (id) {
        input = page.locator(`#${id}, [id^="${id}"]`).first();
      } else if (target.startsWith("#")) {
        input = page.locator(target).first();
      }
      // By label/aria
      if (!input || await input.count() === 0) {
        input = page.locator(`[aria-label*="${target}"], [placeholder*="${target}"]`).first();
      }
      // By tag
      if (step.tag && (!input || await input.count() === 0)) {
        input = page.locator(step.tag).first();
      }

      if (input && await input.count() > 0) {
        // Clear and type (works with ui5 web components)
        await input.click({ timeout: 5000 });
        await page.keyboard.press("Meta+a");
        await page.keyboard.type(value, { delay: 50 });
        console.log(`[SubStep] Typed "${value.slice(0, 30)}" into "${target}"`);
        return true;
      }
      console.warn(`[SubStep] Input not found: "${target}"`);
      return false;
    }

    case "select": {
      // Click the select, then click the option
      let sel = id ? page.locator(`#${id}, [id^="${id}"]`).first() : page.locator(`ui5-select:has-text("${target}")`).first();
      if (sel && await sel.count() > 0) {
        await sel.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        const opt = page.locator(`ui5-option:has-text("${value}")`).first();
        if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
          await opt.click({ timeout: 5000 });
          console.log(`[SubStep] Selected "${value}" in "${target}"`);
          return true;
        }
      }
      console.warn(`[SubStep] Select not found: "${target}"`);
      return false;
    }

    case "wait": {
      await page.waitForTimeout((step.seconds || 2) * 1000);
      return true;
    }

    case "scroll": {
      await page.evaluate('window.scrollBy(0, 400)');
      console.log('[SubStep] Scrolled down');
      return true;
    }

    case "js": {
      // Execute raw JavaScript on the page — for shadow DOM, complex selectors, etc.
      const result = await page.evaluate(step.code);
      console.log(`[SubStep] JS eval: ${step.note || step.code?.slice(0, 50)}`, result || "");
      return true;
    }

    default:
      console.warn(`[SubStep] Unknown action: ${step.action}`);
      return false;
  }
}

/**
 * Try executing all learned sub-steps for a playbook step.
 */
async function executeSubSteps(page, subSteps, context) {
  if (!subSteps) return false;
  const steps = typeof subSteps === "string" ? JSON.parse(subSteps) : subSteps;
  if (!Array.isArray(steps) || steps.length === 0) return false;

  console.log(`[Playbook] Trying ${steps.length} learned sub-steps...`);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    try {
      const ok = await execSubStep(page, s, context);
      if (!ok) {
        console.warn(`[Playbook] Sub-step ${i + 1} failed — falling back to AI`);
        return false;
      }
      await page.waitForTimeout(1000); // pause between actions
    } catch (err) {
      console.warn(`[Playbook] Sub-step ${i + 1} error: ${err.message}`);
      return false;
    }
  }
  console.log("[Playbook] All sub-steps succeeded.");
  return true;
}

/**
 * Execute a single playbook step using AI Vision.
 */
async function executeStepWithAI(page, instruction, aiNote, creds) {
  let context = instruction;
  if (aiNote) context += `\n\nPRIOR KNOWLEDGE FROM PREVIOUS RUNS:\n${aiNote}`;
  return await aiResolve(page, context, { maxAttempts: 12, credentials: creds });
}

/**
 * Main: Execute a full playbook.
 */
export async function executePlaybook({ playbook, steps, connection, sourceData, updateStep, updatePlaybook }) {
  const page = await newPage();
  const username = connection.username || connection.user_name || "";
  const password = connection.password || "";
  const creds = { username, password };
  const context = {
    connection,
    sourceData: Array.isArray(sourceData) ? sourceData[0] || {} : sourceData,
    sourceDataAll: sourceData,
    playbook,
  };

  // Merge CbcSettings config into sourceData for easy access
  if (context.sourceData?.config) {
    try {
      const cfg = typeof context.sourceData.config === "string" ? JSON.parse(context.sourceData.config) : context.sourceData.config;
      Object.assign(context.sourceData, cfg);
    } catch {}
  }

  const startTime = Date.now();
  let failedSteps = 0;

  try {
    console.log(`[Playbook] ═══ Executing: ${playbook.name} ═══`);
    console.log(`[Playbook] System: ${playbook.system_type} | Steps: ${steps.length}`);
    console.log(`[Playbook] Logging into ${connection.system_url}...`);

    const loggedIn = await loginToSystem(page, connection.system_url.replace(/\/$/, ""), username, password);
    if (!loggedIn) throw new Error("Failed to login to target system");
    await screenshot(page, `playbook-${playbook.system_type}-logged-in`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepLabel = `Step ${step.step_order || i + 1}/${steps.length}`;
      const stepStart = Date.now();
      const resolvedInstruction = resolveBindings(step.instruction, step.data_bindings, context);
      console.log(`\n[Playbook] ── ${stepLabel}: ${resolvedInstruction.slice(0, 100)} ──`);

      let success = false;
      let newAiNote = step.ai_note || "";

      // Attempt 1: Learned sub-steps (fast, no AI)
      if (step.sub_steps) {
        success = await executeSubSteps(page, step.sub_steps, context);
      }

      // Attempt 2: AI Vision fallback
      if (!success) {
        console.log(`[Playbook] ${stepLabel}: Using AI Vision...`);
        await screenshot(page, `playbook-step-${i + 1}-before`);
        success = await executeStepWithAI(page, resolvedInstruction, step.ai_note, creds);
        if (success) {
          await screenshot(page, `playbook-step-${i + 1}-after`);
          newAiNote += `\n[${new Date().toISOString().slice(0, 10)}] AI resolved. Duration: ${Date.now() - stepStart}ms.`;
        }
      } else {
        newAiNote += `\n[${new Date().toISOString().slice(0, 10)}] Sub-steps succeeded. Duration: ${Date.now() - stepStart}ms.`;
      }

      // Write back stats
      const duration = Date.now() - stepStart;
      const newRunCount = (step.run_count || 0) + 1;
      const newSuccessCount = (step.success_count || 0) + (success ? 1 : 0);
      const newAvgDuration = step.avg_duration_ms
        ? Math.round((step.avg_duration_ms * (newRunCount - 1) + duration) / newRunCount)
        : duration;

      const stepUpdate = {
        run_count: newRunCount,
        success_count: newSuccessCount,
        avg_duration_ms: newAvgDuration,
        ai_note: newAiNote.slice(0, 50000),
      };
      if (!success) {
        stepUpdate.last_error = `Failed at ${new Date().toISOString()}`;
        failedSteps++;
      }

      try { await updateStep(step.id, stepUpdate); } catch (err) {
        console.warn(`[Playbook] Write-back failed: ${err.message}`);
      }

      console.log(`[Playbook] ${stepLabel}: ${success ? "OK" : "FAILED"} (${duration}ms)`);
      await page.waitForTimeout(1000);
    }

    try {
      await updatePlaybook(playbook.id, {
        run_count: (playbook.run_count || 0) + 1,
        last_run_at: new Date().toISOString(),
        last_run_status: failedSteps > 0 ? "failed" : "completed",
      });
    } catch {}

    const totalDuration = Date.now() - startTime;
    console.log(`\n[Playbook] ═══ ${playbook.name}: ${failedSteps === 0 ? "COMPLETED" : "PARTIAL"} (${totalDuration}ms) ═══`);
    return { playbook_id: playbook.id, total_steps: steps.length, failed_steps: failedSteps, duration_ms: totalDuration, status: failedSteps === 0 ? "completed" : "partial" };

  } catch (err) {
    await screenshot(page, "playbook-fatal-error");
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
