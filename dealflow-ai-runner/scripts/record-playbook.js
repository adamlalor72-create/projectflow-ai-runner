#!/usr/bin/env node
// ProjectFlow AI Runner — Record Mode
// Opens a browser, logs into the target system, then watches you work.
// Every click, type, and navigation is recorded as playbook steps.
// Press Ctrl+C to stop recording and save.

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import config from '../config.js';
import { fetchPlaybook, updatePlaybookStep, updatePlaybook as updatePlaybookAPI } from '../lib/api.js';

const USER_DATA_DIR = path.join(os.homedir(), ".projectflow-runner-profile");
const args = process.argv.slice(2);
const playbookId = args.find(a => !a.startsWith("--"));

if (!playbookId) {
  console.error("Usage: node record-playbook.js <playbook-id>");
  console.error("  Opens CBC/S4 and records your actions as playbook steps.");
  process.exit(1);
}

const recorded = [];
let stepCounter = 0;

function timestamp() {
  return new Date().toISOString();
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   ProjectFlow AI — Playbook Recorder                ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // Fetch playbook to get connection details
  console.log(`[Recorder] Fetching playbook ${playbookId}...`);
  const { playbook, steps, connection, sourceData } = await fetchPlaybook(playbookId);

  if (!connection) {
    console.error("[Recorder] No system connection for", playbook.system_type);
    process.exit(1);
  }

  console.log(`[Recorder] Playbook: ${playbook.name}`);
  console.log(`[Recorder] System: ${playbook.system_type} → ${connection.system_url}`);
  console.log(`[Recorder] Source data fields:`, Object.keys(sourceData?.[0] || sourceData || {}));
  console.log("");

  // Launch persistent browser
  console.log("[Recorder] Launching browser...");
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    slowMo: 0,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Navigate to the system
  const url = connection.system_url.replace(/\/$/, "");
  console.log(`[Recorder] Navigating to ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Try auto-login
  const username = connection.username || connection.user_name || "";
  const password = connection.password || "";
  if (username) {
    await page.waitForTimeout(2000);
    const emailField = await page.$('input[name="j_username"], input[name="email"], input[type="email"], #j_username');
    if (emailField) {
      console.log("[Recorder] Entering email for SSO...");
      await emailField.fill(username);
      const btn = await page.$('button[type="submit"], input[type="submit"]');
      if (btn) await btn.click();
      if (password) {
        await page.waitForTimeout(2000);
        const passField = await page.$('input[name="j_password"], input[name="password"], input[type="password"]');
        if (passField) {
          await passField.fill(password);
          const loginBtn = await page.$('button[type="submit"], input[type="submit"]');
          if (loginBtn) await loginBtn.click();
        }
      }
    }
  }

  await page.waitForTimeout(3000);
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  RECORDING STARTED — do your work in the browser");
  console.log("  Press Ctrl+C when done to save the recording");
  console.log("══════════════════════════════════════════════════════\n");

  // --- Inject recording listeners into every page ---
  async function injectRecorder(p) {
    await p.evaluate(() => {
      if (window.__pfRecorderActive) return;
      window.__pfRecorderActive = true;
      window.__pfRecordedActions = window.__pfRecordedActions || [];

      // Helper to describe an element
      function describe(el) {
        const tag = el.tagName?.toLowerCase() || "";
        const text = (el.textContent || "").trim().slice(0, 80);
        const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "";
        const role = el.getAttribute("role") || "";
        const id = el.id || "";
        const name = el.getAttribute("name") || "";
        const type = el.getAttribute("type") || "";
        return { tag, text, label, role, id, name, type };
      }

      // Record clicks
      document.addEventListener("click", (e) => {
        const d = describe(e.target);
        window.__pfRecordedActions.push({
          action: "click",
          target: d.label || d.text || d.id || `${d.tag}[${d.role}]`,
          detail: d,
          url: location.href,
          ts: Date.now()
        });
      }, true);

      // Record input changes (debounced)
      let inputTimer = {};
      document.addEventListener("input", (e) => {
        const el = e.target;
        const key = el.id || el.name || "input";
        clearTimeout(inputTimer[key]);
        inputTimer[key] = setTimeout(() => {
          const d = describe(el);
          window.__pfRecordedActions.push({
            action: "type",
            target: d.label || d.name || d.id || `${d.tag}`,
            value: el.value || "",
            detail: d,
            url: location.href,
            ts: Date.now()
          });
        }, 500);
      }, true);

      // Record select changes
      document.addEventListener("change", (e) => {
        const el = e.target;
        if (el.tagName === "SELECT" || el.getAttribute("role") === "combobox") {
          const d = describe(el);
          window.__pfRecordedActions.push({
            action: "select",
            target: d.label || d.name || d.id,
            value: el.value || el.textContent?.trim()?.slice(0, 80) || "",
            detail: d,
            url: location.href,
            ts: Date.now()
          });
        }
      }, true);
    });
  }

  // Inject on current page and any new pages
  await injectRecorder(page);
  page.on("framenavigated", async () => {
    try { await injectRecorder(page); } catch {}
  });

  // Poll for recorded actions
  const pollInterval = setInterval(async () => {
    try {
      const actions = await page.evaluate(() => {
        const a = window.__pfRecordedActions || [];
        window.__pfRecordedActions = [];
        return a;
      });
      for (const action of actions) {
        stepCounter++;
        recorded.push(action);
        const label = action.action === "type"
          ? `TYPE "${action.value?.slice(0, 30)}" into ${action.target}`
          : action.action === "select"
          ? `SELECT "${action.value}" in ${action.target}`
          : `CLICK "${action.target}"`;
        console.log(`  [${stepCounter}] ${label}`);
      }
    } catch {}
  }, 1000);

  // Also take periodic screenshots
  const ssInterval = setInterval(async () => {
    try {
      await mkdir("screenshots", { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({ path: `screenshots/record_${ts}.png`, fullPage: false });
    } catch {}
  }, 15000);

  // Handle Ctrl+C — save recording
  process.on("SIGINT", async () => {
    clearInterval(pollInterval);
    clearInterval(ssInterval);

    console.log(`\n\n══════════════════════════════════════════════════════`);
    console.log(`  RECORDING STOPPED — ${recorded.length} actions captured`);
    console.log(`══════════════════════════════════════════════════════\n`);

    // Save raw recording
    const outPath = `recordings/playbook_${playbookId.slice(0, 8)}_${Date.now()}.json`;
    await mkdir("recordings", { recursive: true });
    await writeFile(outPath, JSON.stringify(recorded, null, 2));
    console.log(`[Recorder] Raw recording saved: ${outPath}`);

    // Convert to playbook sub-steps format
    const subSteps = recorded.map((a, i) => ({
      action: a.action,
      target: a.target,
      value: a.value || undefined,
      url: a.url,
    }));

    // Print summary
    console.log("\n── Recorded Steps ──");
    subSteps.forEach((s, i) => {
      const desc = s.action === "type"
        ? `Type "${s.value?.slice(0, 40)}" into "${s.target}"`
        : s.action === "select"
        ? `Select "${s.value}" in "${s.target}"`
        : `Click "${s.target}"`;
      console.log(`  ${i + 1}. ${desc}`);
    });

    console.log(`\n[Recorder] To apply this recording to the playbook, use:`);
    console.log(`  node apply-recording.js ${playbookId} ${outPath}`);

    await context.close();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error("[Recorder] Fatal:", err.message);
  process.exit(1);
});
