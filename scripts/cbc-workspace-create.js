// ProjectFlow AI Runner — CBC Workspace Setup (Deterministic)
// Rewritten from Playwright codegen recording — uses role-based selectors
// that work correctly with UI5 Web Components and stacked dialogs.

import { newPage, screenshot } from '../lib/browser.js';
import { withAIFallback } from '../lib/ai-agent.js';
import { updateStep } from '../lib/api.js';

const COUNTRIES = {
  AE:"UAE",AU:"Australia",CA:"Canada",CH:"Switzerland",DE:"Germany",
  FR:"France",GB:"United Kingdom",IN:"India",JP:"Japan",SA:"Saudi Arabia",
  SG:"Singapore",US:"USA",ZA:"South Africa",NL:"Netherlands",
  SE:"Sweden",IT:"Italy",
};

// ── Helpers ─────────────────────────────────────────────────

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
  await page.waitForTimeout(5000);

  // Check for login form
  const emailField = page.getByRole('textbox', { name: 'Email or User Name' });
  if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[CBC] Login form found');
    await emailField.click();
    await emailField.fill(username);
    await emailField.press('Tab');
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('textbox', { name: 'Password' }).press('Enter');
    await page.waitForTimeout(3000);
    // Handle "Continue" button if it appears (password change/2FA)
    const cont = page.getByRole('button', { name: 'Continue' });
    if (await cont.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cont.click();
      await page.waitForTimeout(3000);
    }
  } else {
    console.log('[CBC] Already authenticated');
  }
  await page.waitForTimeout(3000);

  // Close any lightbox/help popups
  const closeLightbox = page.getByRole('button', { name: 'Close Lightbox' });
  if (await closeLightbox.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeLightbox.click();
    await page.waitForTimeout(500);
  }
  const closeBtn = page.getByRole('button', { name: 'Close' });
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await dismissDialogs(page);
  await screenshot(page, 'cbc-logged-in');
  console.log('[CBC] Logged in');
}

// ══════════════════════════════════════════════════════════════
// Step 1: Create Workspace
// ══════════════════════════════════════════════════════════════
async function stepCreateWorkspace(page, wsName, wsType, creds) {
  console.log(`[CBC] ── Creating workspace: ${wsName} (${wsType}) ──`);

  // Check if Workspaces dialog already open
  const wsDialogOpen = await page.getByRole('button', { name: 'Create New Emphasized' })
    .isVisible({ timeout: 2000 }).catch(() => false);

  if (!wsDialogOpen) {
    // Navigate to Settings → Switch Workspace
    await dismissDialogs(page);
    await withAIFallback(page, async () => {
      await page.evaluate(() => {
        const item = document.querySelector('ui5-side-navigation-item[text="Settings"]') ||
                     document.querySelector('[data-action-name="goToSettings"]');
        if (item) item.click(); else throw new Error('Settings not found');
      });
      console.log('[CBC] Clicked Settings');
    }, 'Click "Settings" in the sidebar.', { credentials: creds });
    await page.waitForTimeout(1500);

    await withAIFallback(page, async () => {
      await page.evaluate(() => {
        const btn = document.querySelector('[data-action-name="switchWorkspace"]');
        if (btn) btn.click();
        else {
          const btns = document.querySelectorAll('ui5-button');
          for (const b of btns) { if ((b.textContent||'').trim().includes('Switch Workspace')) { b.click(); return; } }
          throw new Error('Switch Workspace not found');
        }
      });
      console.log('[CBC] Clicked Switch Workspace');
    }, 'Click "Switch Workspace".', { credentials: creds });
    await page.waitForTimeout(2000);
  } else {
    console.log('[CBC] Workspaces dialog already open');
  }

  // Click "Create New" — from recording: getByRole('button', { name: 'Create New Emphasized' })
  await page.getByRole('button', { name: 'Create New Emphasized' }).click({ timeout: 5000 });
  console.log('[CBC] Clicked Create New');
  await page.waitForTimeout(2000);

  // Fill title — from recording: getByRole('textbox', { name: 'Title' })
  await page.getByRole('textbox', { name: 'Title' }).click({ timeout: 5000 });
  await page.getByRole('textbox', { name: 'Title' }).fill(wsName);
  console.log(`[CBC] Filled title: "${wsName}"`);

  // Select workspace type — from recording: getByRole('combobox', { name: 'Workspace Type' })
  await page.getByRole('combobox', { name: 'Workspace Type' }).click({ timeout: 5000 });
  await page.waitForTimeout(500);
  // Click the matching option
  await page.getByRole('option', { name: wsType }).click({ timeout: 3000 }).catch(async () => {
    // Fallback: click by text in dropdown
    await page.locator(`ui5-option:has-text("${wsType}")`).click({ timeout: 3000 });
  });
  console.log(`[CBC] Selected type: ${wsType}`);

  // Click Create — from recording: getByRole('button', { name: 'Create Emphasized' })
  await page.getByRole('button', { name: 'Create Emphasized' }).click({ timeout: 5000 });
  console.log('[CBC] Clicked Create');
  await page.waitForTimeout(5000);
  await dismissDialogs(page);
  await screenshot(page, `cbc-workspace-${wsName}-created`);
  console.log(`[CBC] Workspace "${wsName}" created`);
}

// ══════════════════════════════════════════════════════════════
// Step 2: Assign Deployment Target
// ══════════════════════════════════════════════════════════════
async function stepAssignDeploymentTarget(page, creds) {
  console.log('[CBC] ── Assigning Deployment Target ──');
  await page.waitForTimeout(3000);
  await screenshot(page, 'cbc-overview-before-assign');

  // Click Assign — from recording: getByRole('button', { name: 'Assign' })
  await page.getByRole('button', { name: 'Assign' }).click({ timeout: 10000 });
  console.log('[CBC] Clicked Assign');
  await page.waitForTimeout(2000);

  // Select first checkbox in the deployment target dialog
  await withAIFallback(page, async () => {
    // Try clicking the row first (triggers selection), then the checkbox
    const checked = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('ui5-dialog[open]')];
      const dlg = dlgs[dlgs.length - 1];
      if (!dlg) return false;
      // Strategy 1: Click the row itself (some UI5 tables select on row click)
      const row = dlg.querySelector('ui5-table-row, tr[role="row"]');
      if (row) { row.click(); }
      // Strategy 2: Find and click checkbox
      const cb = dlg.querySelector('ui5-checkbox, [role="checkbox"]');
      if (cb) { cb.click(); return true; }
      return !!row;
    });
    if (!checked) throw new Error('No checkbox found');
    console.log('[CBC] Clicked deployment target row/checkbox');
  }, 'Select the first deployment target checkbox.', { credentials: creds });

  // Wait for the Assign button to become enabled
  await page.waitForTimeout(2000);
  // Verify button is enabled before clicking
  const assignBtn = page.getByRole('button', { name: 'Assign Emphasized' });
  for (let attempt = 0; attempt < 5; attempt++) {
    const disabled = await assignBtn.getAttribute('disabled').catch(() => null);
    if (!disabled) break;
    console.log(`[CBC] Assign button still disabled, retrying selection (${attempt + 1}/5)...`);
    // Re-click the checkbox/row
    await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('ui5-dialog[open]')];
      const dlg = dlgs[dlgs.length - 1];
      if (!dlg) return;
      const cb = dlg.querySelector('ui5-checkbox, [role="checkbox"]');
      if (cb) cb.click();
      const row = dlg.querySelector('ui5-table-row, tr[role="row"]');
      if (row) row.click();
    }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Click Assign Emphasized — force click if still disabled
  await withAIFallback(page, async () => {
    try {
      await page.getByRole('button', { name: 'Assign Emphasized' }).click({ timeout: 5000 });
    } catch {
      // Force click via evaluate if Playwright refuses
      const clicked = await page.evaluate(() => {
        const dlgs = [...document.querySelectorAll('ui5-dialog[open]')];
        const dlg = dlgs[dlgs.length - 1];
        if (!dlg) return false;
        const btns = dlg.querySelectorAll('ui5-button');
        for (const b of btns) {
          if (b.getAttribute('design') === 'Emphasized' || (b.textContent || '').trim() === 'Assign') {
            b.removeAttribute('disabled');
            b.click();
            return true;
          }
        }
        return false;
      });
      if (!clicked) throw new Error('Assign Emphasized not found');
    }
    console.log('[CBC] Confirmed assignment');
  }, 'Click "Assign" to confirm.', { credentials: creds });
  await page.waitForTimeout(3000);
  await dismissDialogs(page);
  await screenshot(page, 'cbc-deployment-target-assigned');
  console.log('[CBC] Deployment target assigned');
}

// ══════════════════════════════════════════════════════════════
// Step 3: Define Scope (country, bundles, ledger, complete)
// ══════════════════════════════════════════════════════════════
async function stepDefineScope(page, countryCode, countryLabel, bundles, ledgerScenarios, creds) {
  console.log(`[CBC] ── Defining Scope (${countryLabel}) ──`);

  // Click Open — wait for loading cards to finish, then click
  // The activities card has a loading state that intercepts pointer events
  await page.waitForTimeout(3000);
  // Wait for loading cards to finish
  for (let i = 0; i < 10; i++) {
    const loading = await page.evaluate(() => !!document.querySelector('ui5-card[loading]')).catch(() => false);
    if (!loading) break;
    console.log(`[CBC] Waiting for cards to finish loading (${i + 1}/10)...`);
    await page.waitForTimeout(2000);
  }
  await withAIFallback(page, async () => {
    // Try role-based click first
    try {
      await page.getByRole('button', { name: 'Open' }).click({ timeout: 5000 });
      console.log('[CBC] Clicked Open on Define Scope');
      return;
    } catch {}
    // Fallback: evaluate to bypass loading card overlay
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('ui5-button, button');
      for (const btn of btns) {
        if ((btn.textContent || '').trim() === 'Open') { btn.click(); return true; }
      }
      return false;
    });
    if (!clicked) throw new Error('Open button not found');
    console.log('[CBC] Clicked Open via evaluate');
  }, 'Click the "Open" button on the "Define Scope" row.', { credentials: creds });
  await page.waitForTimeout(3000);
  await dismissDialogs(page);

  // Select country — from recording: getByLabel('Selected Country/Region is')
  const countryInput = page.getByLabel('Selected Country/Region is').locator('#ui5-multi-combobox-input');
  await countryInput.click({ timeout: 5000 });
  await countryInput.fill(countryLabel.slice(0, 6)); // Type partial to trigger dropdown
  console.log(`[CBC] Typed country: "${countryLabel.slice(0, 6)}"`);
  await page.waitForTimeout(1500);

  // Click matching dropdown item — dynamic IDs so use text match
  await withAIFallback(page, async () => {
    // Try clicking the dropdown suggestion that contains the country name
    const item = page.getByRole('option', { name: new RegExp(countryLabel, 'i') });
    if (await item.isVisible({ timeout: 2000 }).catch(() => false)) {
      await item.click();
      console.log(`[CBC] Selected country option: ${countryLabel}`);
      return;
    }
    // Fallback: click any visible list item containing the country text
    const li = page.locator(`ui5-li:has-text("${countryLabel}"), ui5-mcb-item:has-text("${countryLabel}")`).first();
    if (await li.isVisible({ timeout: 2000 }).catch(() => false)) {
      await li.click();
      console.log(`[CBC] Selected country via locator: ${countryLabel}`);
      return;
    }
    // Fallback 2: page.evaluate to find and click in popover/static area
    const clicked = await page.evaluate((label) => {
      const all = document.querySelectorAll('ui5-mcb-item, ui5-li, [role="option"]');
      for (const el of all) {
        if ((el.textContent || '').includes(label)) { el.click(); return true; }
      }
      return false;
    }, countryLabel);
    if (!clicked) throw new Error(`Country "${countryLabel}" not found in dropdown`);
    console.log(`[CBC] Selected country via evaluate: ${countryLabel}`);
  }, `Select "${countryLabel}" from the country dropdown.`, { credentials: creds });
  await page.waitForTimeout(1000);

  // Dismiss the "country you have selected" info dialog if it appears
  await page.waitForTimeout(1000);
  await dismissDialogs(page);

  // Click Save — may not be needed if CU already handled it
  try {
    const saveBtn = page.getByRole('button', { name: 'Save Emphasized' });
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click({ timeout: 5000 });
      console.log('[CBC] Saved country selection');
    } else {
      // Try evaluate fallback
      const clicked = await page.evaluate(() => {
        const btns = document.querySelectorAll('ui5-button');
        for (const b of btns) {
          if ((b.textContent || '').trim() === 'Save' && b.getAttribute('design') === 'Emphasized') {
            b.click(); return true;
          }
        }
        return false;
      }).catch(() => false);
      if (clicked) console.log('[CBC] Saved via evaluate');
      else console.log('[CBC] Save button not visible — may have been handled already');
    }
  } catch (e) {
    console.log('[CBC] Save step skipped:', e.message);
  }
  await page.waitForTimeout(3000);
  await dismissDialogs(page);
  await screenshot(page, 'cbc-scope-country-saved');

  // Add bundles — from recording: ui5-card filter + getByLabel('Add')
  if (bundles && bundles.length > 0) {
    console.log(`[CBC] Adding bundles: ${bundles.join(', ')}`);
    for (const bundle of bundles) {
      try {
        const card = page.locator('ui5-card').filter({ hasText: bundle });
        const addBtn = card.getByLabel('Add');
        if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await addBtn.click({ timeout: 5000 });
          console.log(`[CBC] Added bundle: ${bundle}`);
          await page.waitForTimeout(1500);
          await dismissDialogs(page);
        } else {
          console.log(`[CBC] Bundle "${bundle}" — already added or not found`);
        }
      } catch (e) {
        console.warn(`[CBC] Bundle "${bundle}" error: ${e.message}`);
      }
    }
    await screenshot(page, 'cbc-bundles-added');
  }

  // Add ledger scenarios — from recording: ui5-card filter + getByLabel('Add') + 'Confirm and Add Scenario'
  if (ledgerScenarios && ledgerScenarios.length > 0) {
    console.log(`[CBC] Adding ledger scenarios: ${ledgerScenarios.join(', ')}`);
    for (const scenario of ledgerScenarios) {
      try {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(1000);
        const card = page.locator('ui5-card').filter({ hasText: scenario });
        const addBtn = card.getByLabel('Add');
        if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await addBtn.click({ timeout: 5000 });
          console.log(`[CBC] Clicked Add for: ${scenario}`);
          await page.waitForTimeout(2000);
          // Confirm irreversibility — from recording
          const confirmBtn = page.getByRole('button', { name: 'Confirm and Add Scenario' });
          if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await confirmBtn.click({ timeout: 5000 });
            console.log(`[CBC] Confirmed scenario: ${scenario}`);
          }
          await page.waitForTimeout(1500);
          await dismissDialogs(page);
        } else {
          console.log(`[CBC] Scenario "${scenario}" — already added or not found`);
        }
      } catch (e) {
        console.warn(`[CBC] Scenario "${scenario}" error: ${e.message}`);
      }
    }
    await screenshot(page, 'cbc-ledger-scenarios');
  }

  // Complete Activity — from recording: getByRole('button', { name: 'Complete Activity Emphasized' })
  console.log('[CBC] ── Completing Activity ──');
  await page.getByRole('button', { name: 'Complete Activity Emphasized' }).click({ timeout: 10000 });
  console.log('[CBC] Clicked Complete Activity');
  await page.waitForTimeout(2000);

  // Confirm — from recording: getByRole('button', { name: 'Confirm Emphasized' })
  await page.getByRole('button', { name: 'Confirm Emphasized' }).click({ timeout: 5000 });
  console.log('[CBC] Confirmed');
  await page.waitForTimeout(2000);

  // Close progress dialog immediately — from recording: #cancel-milestone-progress-dialog Close
  try {
    const closeBtn = page.locator('#cancel-milestone-progress-dialog').getByRole('button', { name: 'Close' });
    await closeBtn.click({ timeout: 5000 });
    console.log('[CBC] Closed progress dialog');
  } catch {
    // Fallback: dismiss any open dialog
    await dismissDialogs(page);
  }
  await screenshot(page, 'cbc-activity-completed');
  console.log('[CBC] Activity completion triggered — moving on');
}

// ══════════════════════════════════════════════════════════════
// Main export
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

    const wsFrom = cfg.workspace_from || cfg.wsFrom || '';
    const wsTo = cfg.workspace_to || cfg.wsTo || '';
    const wsType = cfg.workspace_type || cfg.workspaceType || 'Evaluation';
    const country = cfg.country || 'GB';
    const countryLabel = COUNTRIES[country] || country;
    const bundles = cfg.bundles || ['Baseline Accelerator'];
    const ledgerScenarios = cfg.ledger_scenarios || cfg.ledger || [];
    const ledgerArr = Array.isArray(ledgerScenarios) ? ledgerScenarios
      : (ledgerScenarios === 'None' ? [] : [ledgerScenarios]);

    // Build workspace name list
    const workspaceNames = [];
    if (wsFrom && wsTo && wsFrom !== wsTo) {
      const pM = wsFrom.match(/^(.*?)(\d+)$/);
      const tM = wsTo.match(/^(.*?)(\d+)$/);
      if (pM && tM && pM[1] === tM[1]) {
        const prefix = pM[1], start = parseInt(pM[2]), end = parseInt(tM[2]), pad = pM[2].length;
        for (let i = start; i <= end; i++) workspaceNames.push(prefix + String(i).padStart(pad, '0'));
      } else { workspaceNames.push(wsFrom, wsTo); }
    } else if (wsFrom) { workspaceNames.push(wsFrom); }

    log(`Creating ${workspaceNames.length} workspace(s): ${workspaceNames.join(', ')}`);
    log(`Type: ${wsType}, Country: ${countryLabel}, Bundles: ${bundles.join(', ')}`);
    if (ledgerArr.length) log(`Ledger scenarios: ${ledgerArr.join(', ')}`);

    // Login
    await loginToCBC(page, baseUrl, connUser, connPass);
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
      } catch (err) {
        log(`Workspace "${wsName}" FAILED: ${err.message}`);
        results.push({ workspace: wsName, status: 'failed', error: err.message });
        await screenshot(page, `cbc-workspace-${wsName}-error`);
      }
    }

    await screenshot(page, 'cbc-final');
    try { await updateStep(step.id, { detail: JSON.stringify({ debug_log: debugLog, results }) }); } catch {}
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
