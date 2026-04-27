// ProjectFlow AI Runner — CBC Workspace Deletion
// Logs into CBC, navigates to each workspace via Switch Workspace, and deletes it.

import { newPage, screenshot } from '../lib/browser.js';
import { withAIFallback } from '../lib/ai-agent.js';
import { updateStep } from '../lib/api.js';

// ── Helpers ─────────────────────────────────────────────────

async function dismissDialogs(page) {
  // Dismiss "in-app help cannot be loaded" native warning first
  const inAppOk = page.getByRole('button', { name: 'OK' });
  if (await inAppOk.isVisible({ timeout: 500 }).catch(() => false)) {
    await inAppOk.click().catch(() => {});
  }
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

  const emailField = page.getByRole('textbox', { name: 'Email or User Name' });
  if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[CBC] Login form found');
    await emailField.click();
    await emailField.fill(username);
    await emailField.press('Tab');
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('textbox', { name: 'Password' }).press('Enter');
    await page.waitForTimeout(3000);
    const cont = page.getByRole('button', { name: 'Continue' });
    if (await cont.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cont.click();
      await page.waitForTimeout(3000);
    }
  } else {
    console.log('[CBC] Already authenticated');
  }
  await page.waitForTimeout(3000);

  // Dismiss in-app help warning
  const inAppHelpOk = page.getByRole('button', { name: 'OK' });
  if (await inAppHelpOk.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inAppHelpOk.click();
    await page.waitForTimeout(500);
    console.log('[CBC] Dismissed in-app help warning');
  }

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

// ── Open the Switch Workspace dialog ────────────────────────
async function openWorkspaceDialog(page, creds) {
  await dismissDialogs(page);
  await withAIFallback(page, async () => {
    await page.evaluate(() => {
      const item = document.querySelector('ui5-side-navigation-item[text="Settings"]') ||
                   document.querySelector('[data-action-name="goToSettings"]');
      if (item) item.click(); else throw new Error('Settings not found');
    });
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
  }, 'Click "Switch Workspace".', { credentials: creds });
  await page.waitForTimeout(2000);
}

// ── Delete a single workspace by name ───────────────────────
async function deleteWorkspace(page, wsName, creds) {
  console.log(`[CBC] ── Deleting workspace: ${wsName} ──`);

  // Search for the workspace in the dialog
  await withAIFallback(page, async () => {
    const searchInput = page.locator('ui5-dialog[open] ui5-input, ui5-dialog[open] input[type="search"], ui5-dialog[open] input').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill(wsName);
      console.log(`[CBC] Searched for: ${wsName}`);
      await page.waitForTimeout(1500);
    }
  }, `Search for workspace named "${wsName}".`, { credentials: creds });

  // Click the workspace row/tile to select it
  await withAIFallback(page, async () => {
    const clicked = await page.evaluate((name) => {
      const dlgs = [...document.querySelectorAll('ui5-dialog[open]')];
      const dlg = dlgs[dlgs.length - 1];
      if (!dlg) return false;
      // Find any element containing the workspace name
      const all = dlg.querySelectorAll('ui5-li, ui5-table-row, [role="row"], [role="option"], .workspace-item');
      for (const el of all) {
        if ((el.textContent || '').includes(name)) {
          el.click();
          return true;
        }
      }
      return false;
    }, wsName);
    if (!clicked) throw new Error(`Workspace "${wsName}" not found in dialog`);
    console.log(`[CBC] Selected workspace: ${wsName}`);
  }, `Click on the workspace named "${wsName}" in the list.`, { credentials: creds });
  await page.waitForTimeout(1000);

  // Switch to the workspace first (required before deletion in CBC)
  await withAIFallback(page, async () => {
    const switchBtn = page.getByRole('button', { name: /Switch|Open|Select/i });
    if (await switchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await switchBtn.click({ timeout: 5000 });
      console.log(`[CBC] Switched to workspace: ${wsName}`);
    }
  }, `Click "Switch" or "Open" to enter the workspace "${wsName}".`, { credentials: creds });
  await page.waitForTimeout(3000);
  await dismissDialogs(page);

  // Navigate to workspace Settings → Delete
  await withAIFallback(page, async () => {
    // Look for a Delete or Remove option in workspace settings
    const deleteBtn = page.getByRole('button', { name: /Delete Workspace|Delete|Remove Workspace/i });
    if (await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await deleteBtn.click({ timeout: 5000 });
      console.log(`[CBC] Clicked Delete on workspace: ${wsName}`);
      return;
    }
    // Try settings menu → delete option
    const settingsBtn = page.locator('[title="Settings"], [data-action="settings"], ui5-button[icon="action-settings"]').first();
    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(1000);
      const delItem = page.getByRole('menuitem', { name: /Delete/i });
      if (await delItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await delItem.click();
        return;
      }
    }
    throw new Error(`No delete button found for workspace "${wsName}"`);
  }, `Find and click "Delete Workspace" or the delete option in the workspace settings menu.`, { credentials: creds });
  await page.waitForTimeout(2000);

  // Confirm deletion dialog
  await withAIFallback(page, async () => {
    // CBC shows a confirmation — click Delete/Confirm
    const confirmDel = page.getByRole('button', { name: /^Delete$|Confirm Delete|Yes, Delete/i });
    if (await confirmDel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmDel.click({ timeout: 5000 });
      console.log(`[CBC] Confirmed deletion of: ${wsName}`);
      return;
    }
    // Fallback via evaluate
    const clicked = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('ui5-dialog[open]')];
      const dlg = dlgs[dlgs.length - 1];
      if (!dlg) return false;
      const btns = dlg.querySelectorAll('ui5-button');
      for (const b of btns) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (t === 'delete' || t === 'confirm' || t === 'yes') { b.click(); return true; }
      }
      return false;
    });
    if (!clicked) throw new Error('Deletion confirmation button not found');
  }, `Click "Delete" or "Confirm" in the deletion confirmation dialog.`, { credentials: creds });
  await page.waitForTimeout(3000);
  await dismissDialogs(page);
  await screenshot(page, `cbc-workspace-${wsName}-deleted`);
  console.log(`[CBC] Workspace "${wsName}" deleted`);
}

// ══════════════════════════════════════════════════════════════
// Main export
// ══════════════════════════════════════════════════════════════
export async function runCBCWorkspaceDelete({ job, step, users, connection, connections }) {
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
    const wsTo = cfg.workspace_to || cfg.wsTo || wsFrom;

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

    if (workspaceNames.length === 0) throw new Error('No workspace names specified in job config');

    log(`Deleting ${workspaceNames.length} workspace(s): ${workspaceNames.join(', ')}`);

    // Login
    await loginToCBC(page, baseUrl, connUser, connPass);
    await page.evaluate(() => { document.body.style.zoom = '0.75'; });
    await page.waitForTimeout(500);

    // Open workspace dialog once, then delete each one
    await openWorkspaceDialog(page, creds);

    const results = [];
    for (let i = 0; i < workspaceNames.length; i++) {
      const wsName = workspaceNames[i];
      log(`\n═══ Workspace ${i + 1}/${workspaceNames.length}: ${wsName} ═══`);
      try {
        await deleteWorkspace(page, wsName, creds);
        results.push({ workspace: wsName, status: 'deleted' });
        log(`Workspace "${wsName}" — deleted`);
        // Re-open the workspace dialog for next iteration
        if (i < workspaceNames.length - 1) {
          await openWorkspaceDialog(page, creds);
        }
      } catch (err) {
        log(`Workspace "${wsName}" FAILED: ${err.message}`);
        results.push({ workspace: wsName, status: 'failed', error: err.message });
        await screenshot(page, `cbc-workspace-${wsName}-delete-error`);
        // Try to re-open workspace dialog for next workspace
        if (i < workspaceNames.length - 1) {
          try { await openWorkspaceDialog(page, creds); } catch {}
        }
      }
    }

    await screenshot(page, 'cbc-delete-final');
    try { await updateStep(step.id, { detail: JSON.stringify({ debug_log: debugLog, results }) }); } catch {}
    const ok = results.filter(r => r.status === 'deleted').length;
    const fail = results.filter(r => r.status === 'failed').length;
    log(`\n═══ Summary: ${ok} deleted, ${fail} failed ═══`);
    return { workspaces: results, total: workspaceNames.length, deleted: ok, failed: fail };
  } catch (err) {
    await screenshot(page, 'cbc-delete-fatal-error');
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
