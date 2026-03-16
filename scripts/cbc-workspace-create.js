// DealFlow AI Runner — CBC Workspace Creation
// JS login only, then Computer Use agent handles everything via pixel-based clicks

import { newPage, screenshot } from '../lib/browser.js';
import { aiResolve } from '../lib/ai-agent.js';
import { updateStep, fetchAIConfig } from '../lib/api.js';

const COUNTRIES = {
  AE:"UAE",AU:"Australia",CA:"Canada",CH:"Switzerland",DE:"Germany",
  FR:"France",GB:"United Kingdom",IN:"India",JP:"Japan",SA:"Saudi Arabia",
  SG:"Singapore",US:"United States",ZA:"South Africa",NL:"Netherlands",
  SE:"Sweden",IT:"Italy"
};

const CBC_PROMPT = (workspaces, type, countryLabel, bundles, ledger) => `
You are automating SAP Central Business Configuration (CBC). Complete these tasks in order:

For EACH workspace name (${workspaces.join(", ")}), do ALL of the following steps before moving to the next:

## Step 1: Navigate to Create Workspace
- Click "Settings" in the bottom-left sidebar
- Click "Switch Workspace" button
- In the Workspaces dialog, click "Create New" (bottom-right)

## Step 2: Fill Workspace Details
- In the "New Workspace" dialog, click the Title input field and type the workspace name
- For workspace type: click the dropdown, select "${type}"
- Click "Create"

## Step 3: Assign Deployment Target
- On the Overview page, click "Assign" next to "Assign Deployment Target"
- In the dialog, select the first checkbox (top of list)
- Click "Assign"

## Step 4: Define Scope — Select Country
- Click "Open" on the "Define Scope" row
- A country selection dialog appears with a multi-combobox
- Click the combobox input, type "${countryLabel}", click the matching item
- Click "Save"

## Step 5: Add Bundles
${bundles.map(b => `- Find the "${b}" bundle card and click "Add"\n- Confirm any dialog`).join("\n")}

## Step 6: Add Ledger Scenarios
${ledger === "None" ? "- Skip — no ledger scenarios required" : `- Scroll to Scenarios → Ledger Scenarios section\n- Click "Add" on each required scenario\n- Click "Confirm and Add Scenario" on the irreversibility warning`}

## Step 7: Complete Activity
- Click "Complete Activity" (top right)
- Click "Confirm" in the dialog
- A progress bar will appear (takes 1-3 minutes) — wait for it
- Click "OK" or "Close" when done
- Press F5 to refresh and verify "Completed" status

## IMPORTANT Technical Notes
- This is a UI5 Web Components app with shadow DOM
- For dropdowns: prefer clicking the visual dropdown element directly
- The sidebar "Settings" item may be at the very bottom — scroll down if needed
- When there are stacked dialogs, interact with the TOP (frontmost) dialog
- After "Create" is clicked, wait for the Overview page to load before proceeding
- Close/dismiss any unexpected popups or "We made updates" dialogs

When ALL workspaces are complete, respond with a summary of what was done.
`;

// ═══════════════════════════════════════════════════════════════
// Main export — JS login, then Computer Use agent does everything
// ═══════════════════════════════════════════════════════════════
export async function runCBCWorkspaceCreate({ job, step, users, connection, connections }) {
  const page = await newPage();
  const connUser = connection.username || connection.user_name || "";
  const connPass = connection.password || "";

  // Read Computer Use settings from AI Settings (org-level)
  let cuApiKey = "";
  let cuModel = "claude-sonnet-4-20250514";
  try {
    const aiConfig = await fetchAIConfig();
    const cfg = typeof aiConfig?.config === "string" ? JSON.parse(aiConfig.config) : (aiConfig?.config || {});
    cuApiKey = cfg.cu_api_key || "";
    cuModel = cfg.cu_model || cuModel;
  } catch (e) { console.warn("[CBC] Could not load AI config:", e.message); }
  console.log(`[CBC] Computer Use: model=${cuModel}, key=${cuApiKey ? "configured" : "NOT SET — will fall back to env var"}`);

  const debugLog = [];
  const log = (msg) => { const ts = new Date().toISOString().slice(11,19); debugLog.push(`[${ts}] ${msg}`); console.log(`[CBC] ${msg}`); };
  const flushLog = async () => {
    try { await updateStep(step.id, { detail: JSON.stringify({ debug_log: debugLog }) }); } catch {}
  };

  try {
    const baseUrl = connection.system_url.replace(/\/$/, "");
    const cfg = typeof job.config === "string" ? JSON.parse(job.config) : (job.config || {});

    // Parse config
    const wsFrom = cfg.workspace_from || cfg.wsFrom || "";
    const wsTo = cfg.workspace_to || cfg.wsTo || "";
    const wsType = cfg.workspace_type || cfg.workspaceType || "Evaluation";
    const country = cfg.country || "GB";
    const countryLabel = COUNTRIES[country] || country;
    const bundles = cfg.bundles || ["Baseline Accelerator"];
    const ledger = cfg.ledger || "None";

    // Build workspace name list
    const workspaceNames = [];
    if (wsFrom && wsTo && wsFrom !== wsTo) {
      const prefixMatch = wsFrom.match(/^(.*?)(\d+)$/);
      const toMatch = wsTo.match(/^(.*?)(\d+)$/);
      if (prefixMatch && toMatch && prefixMatch[1] === toMatch[1]) {
        const prefix = prefixMatch[1];
        const start = parseInt(prefixMatch[2], 10);
        const end = parseInt(toMatch[2], 10);
        const pad = prefixMatch[2].length;
        for (let i = start; i <= end; i++) workspaceNames.push(prefix + String(i).padStart(pad, "0"));
      } else {
        workspaceNames.push(wsFrom, wsTo);
      }
    } else {
      workspaceNames.push(wsFrom);
    }

    log(`Will create ${workspaceNames.length} workspace(s): ${workspaceNames.join(", ")}`);
    log(`Type: ${wsType}, Country: ${countryLabel}, Bundles: ${bundles.join(", ")}, Ledger: ${ledger}`);
    await flushLog();

    // ── JS LOGIN ONLY ──────────────────────────────────────
    log("Logging into CBC at " + baseUrl);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const emailField = await page.$('input[name="j_username"], input[name="email"], input[type="email"], #j_username');
    if (emailField) {
      log("Login form found — entering credentials");
      await emailField.fill(connUser);
      const passField = await page.$('input[name="j_password"], input[name="password"], input[type="password"]');
      if (passField) {
        await passField.fill(connPass);
        const btn = await page.$('button[type="submit"], input[type="submit"]');
        if (btn) await btn.click();
      } else {
        const btn = await page.$('button[type="submit"], input[type="submit"]');
        if (btn) await btn.click();
        await page.waitForTimeout(2000);
        const p2 = await page.$('input[name="j_password"], input[name="password"], input[type="password"]');
        if (p2) { await p2.fill(connPass); const b2 = await page.$('button[type="submit"]'); if (b2) await b2.click(); }
      }
      await page.waitForTimeout(5000);
    } else {
      log("No login form — already authenticated");
    }

    // Verify CBC loaded
    const cbcReady = await page.evaluate(() => {
      return !!(document.querySelector('ui5-side-navigation') || document.body?.innerText?.includes('Central Business Configuration'));
    }).catch(() => false);
    if (!cbcReady) { log("LOGIN FAILED"); await flushLog(); throw new Error("Failed to login to CBC"); }
    log("CBC page loaded");

    // Zoom out so more content fits in the 1024x768 viewport
    await page.evaluate(() => { document.body.style.zoom = '0.75'; });
    await page.waitForTimeout(500);
    log("Page zoom set to 75%");

    // Dismiss welcome dialogs
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1000);
      const dismissed = await page.evaluate(() => {
        const dlgs = document.querySelectorAll('ui5-dialog');
        for (const d of dlgs) {
          if (!d.open && !d.hasAttribute('open')) continue;
          const btns = d.querySelectorAll('ui5-button');
          for (const b of btns) {
            const icon = b.getAttribute('icon') || '';
            if (icon === 'decline' || icon === 'sys-cancel') { b.click(); return 'icon'; }
          }
          for (const b of btns) {
            const t = (b.textContent || '').trim().toLowerCase();
            if (['ok','close','got it','dismiss','skip'].includes(t)) { b.click(); return t; }
          }
          if (typeof d.close === 'function') { d.close(); return 'programmatic'; }
        }
        return null;
      }).catch(() => null);
      if (dismissed) { log(`Dismissed dialog: ${dismissed}`); } else { break; }
    }
    await screenshot(page, "cbc-ready");
    log("Ready — handing off to Computer Use agent");
    await flushLog();

    // ── COMPUTER USE AGENT TAKES OVER ──────────────────────
    const prompt = CBC_PROMPT(workspaceNames, wsType, countryLabel, bundles, ledger);
    log("Computer Use agent prompt length: " + prompt.length + " chars");

    const resolved = await aiResolve(page, prompt, {
      maxAttempts: 50,
      credentials: { username: connUser, password: connPass },
      apiKey: cuApiKey || undefined,
      model: cuModel,
    });

    if (resolved) {
      log("Computer Use agent completed successfully");
    } else {
      log("Computer Use agent did not complete — may have timed out");
    }
    await screenshot(page, "cbc-final");
    await flushLog();

    return { workspaces: workspaceNames, completed: resolved, debug_log: debugLog };
  } catch (err) {
    log(`FATAL: ${err.message}`);
    await flushLog();
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
