// ProjectFlow AI Runner — CBC Workspace Setup (Deterministic)
// Creates workspace, assigns deployment target, defines scope,
// adds bundles/ledger scenarios, completes activity.
// Computer Use only as fallback for unexpected dialogs.

import { newPage, screenshot } from '../lib/browser.js';
import { aiResolve, withAIFallback } from '../lib/ai-agent.js';
import { updateStep } from '../lib/api.js';

const COUNTRIES = {
  AE:"UAE",AU:"Australia",CA:"Canada",CH:"Switzerland",DE:"Germany",
  FR:"France",GB:"United Kingdom",IN:"India",JP:"Japan",SA:"Saudi Arabia",
  SG:"Singapore",US:"United States",ZA:"South Africa",NL:"Netherlands",
  SE:"Sweden",IT:"Italy",
};

// ── Shadow DOM helpers for CBC (UI5 Web Components) ─────────

async function cbcClick(page, selector, label, timeout = 5000) {
  const el = page.locator(selector).first();
  if (await el.isVisible({ timeout }).catch(() => false)) {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout });
    console.log(`[CBC] Clicked: ${label}`);
    return true;
  }
  console.warn(`[CBC] Not found: ${label} (${selector})`);
  return false;
}

async function cbcClickText(page, text, tag = '*', timeout = 5000) {
  // Click element by visible text — handles UI5 shadow DOM
  const selectors = [
    `${tag}:has-text("${text}")`,
    `text="${text}"`,
    `[title="${text}"]`,
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout });
      console.log(`[CBC] Clicked text: "${text}"`);
      return true;
    }
  }
  // Fallback: evaluate in page context for shadow DOM
  const clicked = await page.evaluate((t) => {
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        const txt = (el.textContent || '').trim();
        if (txt === t || txt.includes(t)) { el.click(); return true; }
        if (el.shadowRoot && walk(el.shadowRoot)) return true;
      }
      return false;
    };
    return walk(document);
  }, text).catch(() => false);
  if (clicked) { console.log(`[CBC] Clicked text (shadow): "${text}"`); return true; }
  console.warn(`[CBC] Text not found: "${text}"`);
  return false;
}

async function cbcFillInput(page, selector, value, label) {
  const el = page.locator(selector).first();
  if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
    await el.click({ timeout: 3000 });
    await page.keyboard.press('Meta+a');
    await page.keyboard.type(value, { delay: 30 });
    console.log(`[CBC] Filled ${label}: "${value}"`);
    return true;
  }
  console.warn(`[CBC] Input not found: ${label} (${selector})`);
  return false;
}

async function dismissDialogs(page) {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(800);
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
      }
      return null;
    }).catch(() => null);
    if (dismissed) console.log(`[CBC] Dismissed dialog: ${dismissed}`);
    else break;
  }
}

async function loginToCBC(page, baseUrl, username, password) {
  console.log(`[CBC] Navigating to ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const emailField = await page.$('input[name="j_username"], input[name="email"], input[type="email"], #j_username');
  if (emailField) {
    console.log('[CBC] Login form found');
    await emailField.fill(username);
    const passField = await page.$('input[name="j_password"], input[name="password"], input[type="password"]');
    if (passField) {
      await passField.fill(password);
      const btn = await page.$('button[type="submit"], input[type="submit"]');
      if (btn) await btn.click();
    } else {
      const btn = await page.$('button[type="submit"], input[type="submit"]');
      if (btn) await btn.click();
      await page.waitForTimeout(2000);
      const p2 = await page.$('input[name="j_password"], input[name="password"], input[type="password"]');
      if (p2) { await p2.fill(password); const b2 = await page.$('button[type="submit"]'); if (b2) await b2.click(); }
    }
    await page.waitForTimeout(5000);
  } else {
    console.log('[CBC] Already authenticated');
  }

  const ready = await page.evaluate(() =>
    !!(document.querySelector('ui5-side-navigation') || document.body?.innerText?.includes('Central Business Configuration'))
  ).catch(() => false);
  if (!ready) throw new Error('Failed to login to CBC');
  console.log('[CBC] Logged in');
  await dismissDialogs(page);
  await screenshot(page, 'cbc-logged-in');
}

// ══════════════════════════════════════════════════════════════
// Step functions — one per workspace setup phase
// ══════════════════════════════════════════════════════════════

async function stepCreateWorkspace(page, wsName, wsType, creds) {
  console.log(`[CBC] ── Creating workspace: ${wsName} (${wsType}) ──`);

  // Check if Workspaces dialog is already open (CBC may show it on load or after previous workspace)
  const wsDialogAlreadyOpen = await page.locator('ui5-dialog[header-text="Workspaces"][open], ui5-dialog[data-help-id="switch-project-dialog"][open]').first()
    .isVisible({ timeout: 2000 }).catch(() => false);

  if (wsDialogAlreadyOpen) {
    console.log('[CBC] Workspaces dialog already open — skipping Settings/Switch Workspace');
  } else {
    // Close any other blocking dialogs first
    await dismissDialogs(page);
    await page.waitForTimeout(500);

    // 1. Click Settings in sidebar
    await withAIFallback(page, async () => {
      const clicked = await cbcClick(page, 'ui5-side-navigation-item[text="Settings"]', 'Settings sidebar') ||
        await cbcClickText(page, 'Settings', 'ui5-side-navigation-item');
      if (!clicked) throw new Error('Settings not found in sidebar');
    }, 'Click "Settings" in the bottom-left sidebar navigation.', { credentials: creds });
    await page.waitForTimeout(1500);

    // 2. Click Switch Workspace
    await withAIFallback(page, async () => {
      const clicked = await cbcClickText(page, 'Switch Workspace', 'ui5-button') ||
        await cbcClick(page, '[data-action-name="switchWorkspace"]', 'Switch Workspace');
      if (!clicked) throw new Error('Switch Workspace not found');
    }, 'Click the "Switch Workspace" button on the Settings page.', { credentials: creds });
    await page.waitForTimeout(2000);
  }

  // 3. Click Create New in the workspaces dialog
  await withAIFallback(page, async () => {
    const clicked = await cbcClickText(page, 'Create New', 'ui5-button') ||
      await cbcClick(page, 'ui5-button:has-text("Create")', 'Create New');
    if (!clicked) throw new Error('Create New not found');
  }, 'In the Workspaces dialog, click the "Create New" button (bottom-right).', { credentials: creds });
  await page.waitForTimeout(2000);

  // 4. Fill workspace title
  await withAIFallback(page, async () => {
    // Try multiple selectors for the title input in the new workspace dialog
    const filled = await cbcFillInput(page, 'ui5-input[placeholder*="Title"], ui5-input[placeholder*="title"], ui5-dialog ui5-input', wsName, 'Workspace Title');
    if (!filled) {
      // Try generic input inside open dialog
      const inputs = await page.$$('ui5-dialog[open] ui5-input, ui5-dialog ui5-input');
      for (const inp of inputs) {
        if (await inp.isVisible().catch(() => false)) {
          await inp.click();
          await page.keyboard.press('Meta+a');
          await page.keyboard.type(wsName, { delay: 30 });
          console.log(`[CBC] Filled title via dialog input: "${wsName}"`);
          break;
        }
      }
    }
  }, `Type "${wsName}" into the Title input field in the New Workspace dialog.`, { credentials: creds });
  await page.waitForTimeout(500);

  // 5. Select workspace type (Evaluation or Implementation)
  await withAIFallback(page, async () => {
    const sel = page.locator('ui5-select, ui5-dialog select, ui5-dialog ui5-select').first();
    if (await sel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sel.click();
      await page.waitForTimeout(500);
      await cbcClickText(page, wsType, 'ui5-option');
      console.log(`[CBC] Selected workspace type: ${wsType}`);
    }
  }, `Select "${wsType}" from the workspace type dropdown in the dialog.`, { credentials: creds });
  await page.waitForTimeout(500);

  // 6. Click Create
  await withAIFallback(page, async () => {
    const clicked = await cbcClick(page, 'ui5-dialog[open] ui5-button[design="Emphasized"]', 'Create button') ||
      await cbcClickText(page, 'Create', 'ui5-button');
    if (!clicked) throw new Error('Create button not found');
  }, 'Click the "Create" button to create the workspace.', { credentials: creds });
  await page.waitForTimeout(5000);
  await dismissDialogs(page);
  await screenshot(page, `cbc-workspace-${wsName}-created`);
  console.log(`[CBC] Workspace "${wsName}" created`);
}

async function stepAssignDeploymentTarget(page, creds) {
  console.log('[CBC] ── Assigning Deployment Target ──');

  // Click "Assign" next to "Assign Deployment Target" on the Overview page
  await withAIFallback(page, async () => {
    // The Overview page has rows with action buttons — find "Assign" near deployment target text
    const clicked = await page.evaluate(() => {
      const walk = (root) => {
        const all = root.querySelectorAll('ui5-button, button, [role="button"]');
        for (const btn of all) {
          const txt = (btn.textContent || '').trim();
          if (txt === 'Assign') {
            // Check if nearby text mentions "Deployment Target"
            const row = btn.closest('ui5-li, li, tr, [role="row"], div') || btn.parentElement;
            const rowText = (row?.textContent || '').toLowerCase();
            if (rowText.includes('deployment') || rowText.includes('target')) {
              btn.click(); return true;
            }
          }
        }
        // Fallback: click the first "Assign" button
        for (const btn of all) {
          if ((btn.textContent || '').trim() === 'Assign') { btn.click(); return true; }
        }
        return false;
      };
      return walk(document);
    }).catch(() => false);
    if (!clicked) throw new Error('Assign button not found');
  }, 'Click the "Assign" button next to "Assign Deployment Target" on the Overview page.', { credentials: creds });
  await page.waitForTimeout(2000);

  // Select the first checkbox/radio in the deployment target dialog
  await withAIFallback(page, async () => {
    const selected = await page.evaluate(() => {
      const checks = document.querySelectorAll('ui5-dialog[open] ui5-checkbox, ui5-dialog[open] ui5-radio-button, ui5-dialog[open] input[type="checkbox"], ui5-dialog[open] input[type="radio"]');
      if (checks.length > 0) { checks[0].click(); return true; }
      // Try table row selection
      const rows = document.querySelectorAll('ui5-dialog[open] ui5-table-row, ui5-dialog[open] tr');
      if (rows.length > 0) { rows[0].click(); return true; }
      return false;
    }).catch(() => false);
    if (!selected) throw new Error('No deployment target option found');
  }, 'Select the first deployment target in the dialog by clicking its checkbox or row.', { credentials: creds });
  await page.waitForTimeout(1000);

  // Click Assign/OK in the dialog
  await withAIFallback(page, async () => {
    const clicked = await cbcClick(page, 'ui5-dialog[open] ui5-button[design="Emphasized"]', 'Assign confirm') ||
      await cbcClickText(page, 'Assign', 'ui5-button') ||
      await cbcClickText(page, 'OK', 'ui5-button');
    if (!clicked) throw new Error('Assign confirm button not found');
  }, 'Click "Assign" or "OK" to confirm the deployment target selection.', { credentials: creds });
  await page.waitForTimeout(3000);
  await dismissDialogs(page);
  await screenshot(page, 'cbc-deployment-target-assigned');
  console.log('[CBC] Deployment target assigned');
}

async function stepDefineScope(page, countryCode, countryLabel, bundles, ledgerScenarios, creds) {
  console.log(`[CBC] ── Defining Scope (${countryLabel}) ──`);

  // Click "Open" on the Define Scope row
  await withAIFallback(page, async () => {
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('ui5-button, button, [role="button"]');
      for (const btn of btns) {
        const txt = (btn.textContent || '').trim();
        if (txt === 'Open') {
          const row = btn.closest('ui5-li, li, tr, [role="row"], div') || btn.parentElement;
          const rowText = (row?.textContent || '').toLowerCase();
          if (rowText.includes('scope') || rowText.includes('define')) {
            btn.click(); return true;
          }
        }
      }
      // Fallback: click first "Open" button
      for (const btn of btns) {
        if ((btn.textContent || '').trim() === 'Open') { btn.click(); return true; }
      }
      return false;
    }).catch(() => false);
    if (!clicked) throw new Error('Open button for Define Scope not found');
  }, 'Click the "Open" button on the "Define Scope" row.', { credentials: creds });
  await page.waitForTimeout(3000);
  await dismissDialogs(page);

  // Select country in multi-combobox
  await withAIFallback(page, async () => {
    // Find the country multi-combobox
    const mcb = page.locator('ui5-multi-combobox, ui5-combobox, [id*="country"], [placeholder*="country" i]').first();
    if (await mcb.isVisible({ timeout: 5000 }).catch(() => false)) {
      await mcb.click();
      await page.waitForTimeout(500);
      await page.keyboard.type(countryLabel, { delay: 50 });
      await page.waitForTimeout(1000);
      // Click the matching item in the dropdown
      const item = page.locator(`ui5-mcb-item:has-text("${countryLabel}"), ui5-li:has-text("${countryLabel}"), ui5-cb-item:has-text("${countryLabel}")`).first();
      if (await item.isVisible({ timeout: 3000 }).catch(() => false)) {
        await item.click();
        console.log(`[CBC] Selected country: ${countryLabel}`);
      } else {
        // Try clicking by text directly
        await cbcClickText(page, countryLabel);
      }
    } else {
      throw new Error('Country combobox not found');
    }
  }, `Select "${countryLabel}" in the country selection combobox. Type it and click the matching option.`, { credentials: creds });
  await page.waitForTimeout(1000);

  // Click Save to confirm country
  await withAIFallback(page, async () => {
    const clicked = await cbcClick(page, 'ui5-button[design="Emphasized"]:has-text("Save")', 'Save') ||
      await cbcClickText(page, 'Save', 'ui5-button');
    if (!clicked) throw new Error('Save button not found');
  }, 'Click "Save" to confirm the country selection.', { credentials: creds });
  await page.waitForTimeout(3000);
  await dismissDialogs(page);
  await screenshot(page, 'cbc-scope-country-saved');
  console.log(`[CBC] Country ${countryLabel} saved`);

  // Add bundles (Baseline Accelerator + Enterprise Management usually pre-selected)
  if (bundles && bundles.length > 0) {
    console.log(`[CBC] Adding bundles: ${bundles.join(', ')}`);
    for (const bundle of bundles) {
      try {
        // Look for bundle card and click its Add button
        const added = await page.evaluate((bundleName) => {
          const cards = document.querySelectorAll('ui5-card, [role="region"], div');
          for (const card of cards) {
            const text = (card.textContent || '').trim();
            if (text.includes(bundleName)) {
              const btn = card.querySelector('ui5-button:has-text("Add"), button');
              if (btn && (btn.textContent || '').trim() === 'Add') {
                btn.click(); return true;
              }
            }
          }
          return false;
        }, bundle).catch(() => false);
        if (added) {
          console.log(`[CBC] Added bundle: ${bundle}`);
          await page.waitForTimeout(1500);
          await dismissDialogs(page);
        } else {
          console.log(`[CBC] Bundle "${bundle}" — may already be selected or not found`);
        }
      } catch (e) {
        console.warn(`[CBC] Bundle "${bundle}" error: ${e.message}`);
      }
    }
    await screenshot(page, 'cbc-bundles-added');
  }

  // Add ledger scenarios (e.g. US GAAP 2VA)
  if (ledgerScenarios && ledgerScenarios.length > 0) {
    console.log(`[CBC] Adding ledger scenarios: ${ledgerScenarios.join(', ')}`);
    for (const scenario of ledgerScenarios) {
      try {
        // Scroll down to find ledger/scenarios section
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(1000);

        const added = await page.evaluate((name) => {
          const all = document.querySelectorAll('ui5-button, button');
          // Find "Add" button near the scenario text
          for (const btn of all) {
            if ((btn.textContent || '').trim() !== 'Add') continue;
            const parent = btn.closest('[role="region"], ui5-card, div') || btn.parentElement;
            if ((parent?.textContent || '').includes(name)) { btn.click(); return true; }
          }
          return false;
        }, scenario).catch(() => false);

        if (added) {
          console.log(`[CBC] Clicked Add for scenario: ${scenario}`);
          await page.waitForTimeout(2000);
          // Confirm irreversibility warning
          const confirmed = await cbcClick(page, 'ui5-dialog[open] ui5-button[design="Emphasized"]', 'Confirm scenario') ||
            await cbcClickText(page, 'Confirm and Add Scenario', 'ui5-button') ||
            await cbcClickText(page, 'Confirm', 'ui5-button');
          if (confirmed) console.log(`[CBC] Confirmed scenario: ${scenario}`);
          await page.waitForTimeout(1500);
          await dismissDialogs(page);
        } else {
          console.log(`[CBC] Scenario "${scenario}" not found or already added`);
        }
      } catch (e) {
        console.warn(`[CBC] Scenario "${scenario}" error: ${e.message}`);
      }
    }
    await screenshot(page, 'cbc-ledger-scenarios');
  }

  // Complete Activity — click, confirm, close immediately (don't wait for progress)
  console.log('[CBC] ── Completing Activity ──');
  await withAIFallback(page, async () => {
    const clicked = await cbcClickText(page, 'Complete Activity', 'ui5-button') ||
      await cbcClick(page, '[data-action-name="completeActivity"]', 'Complete Activity');
    if (!clicked) throw new Error('Complete Activity button not found');
  }, 'Click the "Complete Activity" button (top-right of the Define Scope page).', { credentials: creds });
  await page.waitForTimeout(2000);

  // Confirm dialog
  await withAIFallback(page, async () => {
    const clicked = await cbcClick(page, 'ui5-dialog[open] ui5-button[design="Emphasized"]', 'Confirm') ||
      await cbcClickText(page, 'Confirm', 'ui5-button');
    if (!clicked) throw new Error('Confirm button not found');
  }, 'Click "Confirm" in the confirmation dialog.', { credentials: creds });
  await page.waitForTimeout(2000);

  // Close immediately — don't wait for progress bar
  await dismissDialogs(page);
  // Try to close any remaining dialogs
  for (const text of ['Close', 'OK', 'Cancel']) {
    const closed = await cbcClickText(page, text, 'ui5-button').catch(() => false);
    if (closed) break;
  }
  await screenshot(page, 'cbc-activity-completed');
  console.log('[CBC] Activity completion triggered — moving on');
}

// ══════════════════════════════════════════════════════════════
// Main export — deterministic workspace setup
// ══════════════════════════════════════════════════════════════
export async function runCBCWorkspaceCreate({ job, step, users, connection, connections }) {
  const page = await newPage();
  const connUser = connection.username || connection.user_name || '';
  const connPass = connection.password || '';
  const creds = { username: connUser, password: connPass };
  const debugLog = [];
  const log = (msg) => { debugLog.push(`[${new Date().toISOString().slice(11,19)}] ${msg}`); console.log(`[CBC] ${msg}`); };

  try {
    const baseUrl = connection.system_url.replace(/\/$/, '');
    const cfg = typeof job.config === 'string' ? JSON.parse(job.config) : (job.config || {});

    // Parse workspace config
    const wsFrom = cfg.workspace_from || cfg.wsFrom || '';
    const wsTo = cfg.workspace_to || cfg.wsTo || '';
    const wsType = cfg.workspace_type || cfg.workspaceType || 'Evaluation';
    const country = cfg.country || 'GB';
    const countryLabel = COUNTRIES[country] || country;
    const bundles = cfg.bundles || ['Baseline Accelerator'];
    const ledgerScenarios = cfg.ledger_scenarios || cfg.ledger || [];
    const ledgerArr = Array.isArray(ledgerScenarios) ? ledgerScenarios : (ledgerScenarios === 'None' ? [] : [ledgerScenarios]);

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
        for (let i = start; i <= end; i++) workspaceNames.push(prefix + String(i).padStart(pad, '0'));
      } else {
        workspaceNames.push(wsFrom, wsTo);
      }
    } else if (wsFrom) {
      workspaceNames.push(wsFrom);
    }

    log(`Creating ${workspaceNames.length} workspace(s): ${workspaceNames.join(', ')}`);
    log(`Type: ${wsType}, Country: ${countryLabel}, Bundles: ${bundles.join(', ')}`);
    if (ledgerArr.length) log(`Ledger scenarios: ${ledgerArr.join(', ')}`);

    // Login
    await loginToCBC(page, baseUrl, connUser, connPass);
    // Zoom out for better viewport coverage
    await page.evaluate(() => { document.body.style.zoom = '0.75'; });
    await page.waitForTimeout(500);

    // Process each workspace
    const results = [];
    for (let i = 0; i < workspaceNames.length; i++) {
      const wsName = workspaceNames[i];
      log(`\n═══ Workspace ${i + 1}/${workspaceNames.length}: ${wsName} ═══`);

      try {
        await stepCreateWorkspace(page, wsName, wsType, creds);
        await stepAssignDeploymentTarget(page, creds);
        await stepDefineScope(page, country, countryLabel, bundles, ledgerArr, creds);
        results.push({ workspace: wsName, status: 'completed' });
        log(`Workspace "${wsName}" — all steps completed`);

        // Navigate back to Settings → Switch Workspace for next iteration
        if (i < workspaceNames.length - 1) {
          log('Navigating back for next workspace...');
          await page.waitForTimeout(2000);
          // The Workspaces dialog might reappear, or we need to go back via Settings
          // stepCreateWorkspace handles both cases (dialog already open or not)
        }
      } catch (err) {
        log(`Workspace "${wsName}" FAILED: ${err.message}`);
        results.push({ workspace: wsName, status: 'failed', error: err.message });
        await screenshot(page, `cbc-workspace-${wsName}-error`);
        // Continue to next workspace — don't abort the entire job
      }
    }

    await screenshot(page, 'cbc-final');
    const flushLog = async () => {
      try { await updateStep(step.id, { detail: JSON.stringify({ debug_log: debugLog, results }) }); } catch {}
    };
    await flushLog();

    const ok = results.filter(r => r.status === 'completed').length;
    const fail = results.filter(r => r.status === 'failed').length;
    log(`\n═══ Summary: ${ok} completed, ${fail} failed ═══`);

    return { workspaces: results, total: workspaceNames.length, completed: ok, failed: fail };
  } catch (err) {
    await screenshot(page, 'cbc-fatal-error');
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
