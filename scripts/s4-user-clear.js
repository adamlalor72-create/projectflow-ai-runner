// DealFlow AI Runner — S/4 User Clear (Deterministic Two-App Flow)
// Recorded from Playwright codegen — no Computer Use needed.
//
// App 1: Manage Workforce (WorkforcePerson-manage_v2)
//   → Search by Worker ID → Go → Select row → Navigate → Edit
//   → Clear First Name, set Last Name="Cleared", clear Full Name, set Email=dummy
//   → Save
//
// App 2: Maintain Business Users (via "Maintain Business User" button on MW detail)
//   → Check Locked checkbox state
//   → If unlocked: Select All roles → Remove → Save → Lock → Save
//   → If already locked: skip

import {
  newPage, loginToSystem, navigateToApp, waitForUI5Ready,
  screenshot
} from '../lib/browser.js';
import { aiResolve } from '../lib/ai-agent.js';

const MW_APP = "WorkforcePerson-manage_v2";

async function verifyNoErrors(page, stepLabel, creds) {
  try {
    const errorPopup = await page.locator('.sapMMessageDialog, [role="alertdialog"], .sapMMsgBox')
      .first().isVisible({ timeout: 1500 }).catch(() => false);
    if (errorPopup) {
      console.warn(`[S4-Clear] Error dialog after ${stepLabel} — AI recovering...`);
      await screenshot(page, `s4-clear-error-at-${stepLabel}`);
      await aiResolve(page,
        `An error dialog appeared after ${stepLabel}. Read it, dismiss it (OK/Close/Cancel), and return to usable state.`,
        { maxAttempts: 3, credentials: creds }
      );
    }
  } catch {}
}

/**
 * Clear one user in S/4HANA using deterministic Playwright selectors.
 * Returns after both MW personal data + MBU lock/roles are done.
 */
async function clearOneUser(page, workerId, baseUrl, creds) {
  const dummyEmail = `cleared.${workerId.toLowerCase()}@dummy.com`;

  // ── Part 1: Manage Workforce — clear personal data ──────────
  console.log(`[S4-Clear] [MW] Navigating to Manage Workforce...`);
  await navigateToApp(page, baseUrl, MW_APP);
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 15000);

  // Search by Worker ID
  console.log(`[S4-Clear] [MW] Searching for ${workerId}...`);
  const workerIdInput = page.getByRole('textbox', { name: 'Worker ID' });
  await workerIdInput.click();
  await workerIdInput.fill(workerId);
  await workerIdInput.press('Enter');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
  await screenshot(page, `s4-clear-mw-search-${workerId}`);

  // Select the row and navigate to detail
  console.log(`[S4-Clear] [MW] Opening detail for ${workerId}...`);
  await page.getByRole('radio', { name: 'Item Selection' }).first().click();
  await page.waitForTimeout(500);
  await page.getByTitle('Navigation', { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
  await screenshot(page, `s4-clear-mw-detail-${workerId}`);

  // Click Edit
  console.log(`[S4-Clear] [MW] Entering edit mode...`);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.waitForTimeout(1500);
  await waitForUI5Ready(page, 5000);

  // Clear personal data fields
  console.log(`[S4-Clear] [MW] Clearing personal data...`);

  // First Name → empty
  const firstNameInput = page.getByRole('textbox', { name: 'First Name' });
  await firstNameInput.click();
  await firstNameInput.fill('');
  await firstNameInput.press('Tab');
  await page.waitForTimeout(300);
  console.log(`[S4-Clear] [MW]   ✓ First Name → (empty)`);

  // Last Name → "Cleared"
  const lastNameInput = page.getByRole('textbox', { name: 'Last Name' });
  await lastNameInput.click();
  await lastNameInput.fill('Cleared');
  await lastNameInput.press('Tab');
  await page.waitForTimeout(300);
  console.log(`[S4-Clear] [MW]   ✓ Last Name → "Cleared"`);

  // Full Name → empty
  const fullNameInput = page.getByRole('textbox', { name: 'Full Name' });
  await fullNameInput.click();
  await fullNameInput.fill('');
  await fullNameInput.press('Tab');
  await page.waitForTimeout(300);
  console.log(`[S4-Clear] [MW]   ✓ Full Name → (empty)`);

  // Email → dummy
  const emailInput = page.getByRole('textbox', { name: 'Email' });
  await emailInput.click();
  await emailInput.fill(dummyEmail);
  await emailInput.press('Tab');
  await page.waitForTimeout(300);
  console.log(`[S4-Clear] [MW]   ✓ Email → "${dummyEmail}"`);

  // Save
  console.log(`[S4-Clear] [MW] Saving...`);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(3000);
  await waitForUI5Ready(page, 10000);
  await verifyNoErrors(page, "mw-save", creds);
  await screenshot(page, `s4-clear-mw-saved-${workerId}`);
  console.log(`[S4-Clear] [MW] ✓ Personal data cleared`);

  // ── Part 2: Maintain Business Users — lock + remove roles ───
  // Navigate directly from MW detail page via the button
  console.log(`[S4-Clear] [MBU] Navigating via Maintain Business User button...`);
  await page.getByRole('button', { name: 'Maintain Business User' }).click();
  await page.waitForTimeout(3000);
  await waitForUI5Ready(page, 15000);
  await screenshot(page, `s4-clear-mbu-detail-${workerId}`);

  // Check if already locked
  const lockedCheckbox = page.getByRole('checkbox', { name: 'Locked' });
  let alreadyLocked = false;
  try {
    await lockedCheckbox.waitFor({ state: 'visible', timeout: 5000 });
    alreadyLocked = await lockedCheckbox.isChecked();
  } catch {
    console.warn(`[S4-Clear] [MBU] Could not find Locked checkbox`);
  }
  console.log(`[S4-Clear] [MBU] Lock state: ${alreadyLocked ? "LOCKED" : "UNLOCKED"}`);

  // Always try to remove roles regardless of lock state
  // First check if there are any roles listed
  let madeChanges = false;
  const hasNoRoles = await page.locator('text=/Assigned Business Roles \\(0\\)/').isVisible({ timeout: 1000 }).catch(() => false);
  if (hasNoRoles) {
    console.log(`[S4-Clear] [MBU]   No roles assigned — skipping removal`);
  } else {
    console.log(`[S4-Clear] [MBU] Removing business roles...`);
    const selectAllCb = page.getByRole('checkbox', { name: 'Select All' });
    try {
      await selectAllCb.waitFor({ state: 'visible', timeout: 1500 });
      await selectAllCb.click();
      await page.waitForTimeout(500);
      const removeBtn = page.getByRole('button', { name: 'Remove' });
      await removeBtn.click();
      await page.waitForTimeout(1000);
      console.log(`[S4-Clear] [MBU]   ✓ Roles removed`);
      madeChanges = true;
    } catch {
      console.log(`[S4-Clear] [MBU]   No roles to remove`);
    }
  }

  // Lock the user if not already locked
  if (!alreadyLocked) {
    console.log(`[S4-Clear] [MBU] Locking user...`);
    await lockedCheckbox.click();
    await page.waitForTimeout(500);
    madeChanges = true;
  }

  // Only save if we actually changed something
  if (madeChanges) {
    console.log(`[S4-Clear] [MBU] Saving...`);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);
    await waitForUI5Ready(page, 10000);
    await verifyNoErrors(page, "mbu-save", creds);
  } else {
    console.log(`[S4-Clear] [MBU] No changes needed — skipping save`);
  }

  await screenshot(page, `s4-clear-mbu-done-${workerId}`);
  console.log(`[S4-Clear] [MBU] ✓ Done`);
}

// ── Main ──────────────────────────────────────────────────────

export async function runS4UserClear({ job, step, users, connection }) {
  const page = await newPage();
  const connUser = connection.username || connection.user_name || "";
  const connPass = connection.password || "";
  const creds = { username: connUser, password: connPass };

  // Read user_configs from job config
  let userConfigs = [];
  try {
    const cfg = typeof job.config === "string" ? JSON.parse(job.config) : (job.config || {});
    userConfigs = (cfg.user_configs || []).filter(uc => uc.run_s4 !== false);
  } catch {}

  const targetUsers = userConfigs.length > 0
    ? userConfigs.map(uc => {
        const dbUser = users.find(u => u.id === uc.user_id);
        return { worker_id: uc.worker_id, ...(dbUser || {}) };
      })
    : users;

  if (targetUsers.length === 0) {
    console.log("[S4-Clear] No users with S4 clear enabled, skipping.");
    return { total_users: 0, cleared: 0, skipped: 0, failed: 0, results: [], timestamp: new Date().toISOString() };
  }

  try {
    const baseUrl = connection.system_url.replace(/\/$/, "");

    // Login
    console.log("[S4-Clear] Logging into S/4HANA...");
    const loggedIn = await loginToSystem(page, baseUrl, connUser, connPass);
    if (!loggedIn) throw new Error("Failed to login to S/4HANA");

    const results = [];
    let cleared = 0, failed = 0, skipped = 0;

    for (let i = 0; i < targetUsers.length; i++) {
      const u = targetUsers[i];
      const label = `${i + 1}/${targetUsers.length}`;
      const wid = u.worker_id;

      if (!wid) {
        console.warn(`[S4-Clear] [${label}] Skipping — no worker ID`);
        results.push({ status: "skipped", reason: "no_worker_id" });
        skipped++;
        continue;
      }

      try {
        console.log(`\n[S4-Clear] [${label}] ═══ Processing ${wid} ═══`);
        await clearOneUser(page, wid, baseUrl, creds);
        cleared++;
        results.push({ worker_id: wid, status: "cleared" });
        console.log(`[S4-Clear] [${label}] ✓ ${wid} fully cleared\n`);
      } catch (err) {
        console.error(`[S4-Clear] [${label}] ✗ Failed ${wid}: ${err.message}`);
        await screenshot(page, `s4-clear-error-${wid}`);
        failed++;
        results.push({ worker_id: wid, status: "failed", error: err.message });
      }
    }

    console.log(`\n[S4-Clear] ════════════════════════════════════════`);
    console.log(`[S4-Clear] ${cleared} cleared, ${skipped} skipped, ${failed} failed`);
    console.log(`[S4-Clear] ════════════════════════════════════════\n`);

    if (failed > 0 && cleared === 0 && skipped === 0) {
      throw new Error(`All ${failed} user(s) failed`);
    }

    return {
      total_users: targetUsers.length, cleared, skipped, failed,
      results, timestamp: new Date().toISOString(),
    };

  } catch (err) {
    await screenshot(page, "s4-clear-fatal-error");
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
