// DealFlow AI Runner — S/4 User Clear
// Navigates to Maintain Business Users, locks each user, clears personal data,
// and removes all business role assignments via Playwright.
// Mandatory fields: Last Name → "CLEARED_{worker_id}", Email → "cleared_{worker_id}@deleted.local"

import {
  newPage, loginToSystem, navigateToApp, waitForUI5Ready,
  clickUI5Button, screenshot
} from '../lib/browser.js';
import { aiResolve, withAIFallback } from '../lib/ai-agent.js';

const MAINTAIN_BU_APP = "BusinessUser-maintain";

/**
 * Check for unexpected error dialogs and recover via AI.
 */
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
 * Search for a user in Maintain Business Users list by User ID.
 */
async function searchUser(page, workerId, creds) {
  // Clear any existing search and type new one
  await withAIFallback(page, async () => {
    // Try the search field
    const searchInputs = await page.$$('input[type="search"], input[type="text"], .sapMSF input');
    for (const input of searchInputs) {
      if (await input.isVisible().catch(() => false)) {
        await input.click();
        await input.fill("");
        await input.fill(workerId);
        await input.press("Enter");
        console.log(`[S4-Clear] Searched for: ${workerId}`);
        return;
      }
    }
    throw new Error("No search input found");
  }, `Find the search bar at the top of the Maintain Business Users list and search for user ID "${workerId}". Type the ID and press Enter.`,
  { credentials: creds });

  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
}

/**
 * Click on a user row in the search results to open their detail.
 */
async function openUserDetail(page, workerId, creds) {
  await withAIFallback(page, async () => {
    // Click on the row containing the worker ID
    const rows = await page.$$('tr, .sapMLIB, .sapMListItem, [role="row"]');
    for (const row of rows) {
      const text = await row.textContent().catch(() => "");
      if (text.includes(workerId)) {
        await row.click();
        console.log(`[S4-Clear] Opened user: ${workerId}`);
        return;
      }
    }
    // Try direct link/text click
    const link = page.locator(`text=${workerId}`).first();
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      return;
    }
    throw new Error(`User row not found for ${workerId}`);
  }, `Click on the row for user "${workerId}" in the search results list to open their details.`,
  { credentials: creds });

  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
}

/**
 * Lock the user — toggle the lock switch/checkbox.
 */
async function lockUser(page, workerId, creds) {
  console.log(`[S4-Clear] Locking user ${workerId}...`);
  await withAIFallback(page, async () => {
    // Look for a "Lock" button or "Locked" toggle/checkbox
    // In Maintain Business Users, there's typically a "Lock/Unlock" button in the toolbar
    const lockBtn = page.locator('button, [role="button"]').filter({ hasText: /Lock/i }).first();
    if (await lockBtn.isVisible({ timeout: 3000 })) {
      await lockBtn.click();
      console.log(`[S4-Clear] Clicked Lock button`);
      return;
    }
    // Try checkbox/switch labeled "Locked"
    const lockSwitch = page.locator('[role="switch"], [role="checkbox"]').filter({ hasText: /Lock/i }).first();
    if (await lockSwitch.isVisible({ timeout: 2000 })) {
      const checked = await lockSwitch.getAttribute("aria-checked");
      if (checked !== "true") {
        await lockSwitch.click();
        console.log(`[S4-Clear] Toggled lock switch`);
      } else {
        console.log(`[S4-Clear] User already locked`);
      }
      return;
    }
    throw new Error("Lock control not found");
  }, `On the business user detail page for "${workerId}", find and click the "Lock" button or toggle to lock this user. The lock control is usually in the header toolbar area.`,
  { credentials: creds });

  await page.waitForTimeout(1000);
  await verifyNoErrors(page, "lock-user", creds);
}

/**
 * Clear personal details — replace mandatory fields with dummy values.
 */
async function clearPersonalData(page, workerId, creds) {
  console.log(`[S4-Clear] Clearing personal data for ${workerId}...`);
  const dummyLastName = `CLEARED_${workerId}`;
  const dummyEmail = `cleared_${workerId.toLowerCase()}@deleted.local`;

  await withAIFallback(page, async () => {
    // We need to find and clear/replace the personal detail fields
    // Strategy: use page.evaluate to find UI5 inputs by label
    const fieldsCleared = await page.evaluate(({ dummyLastName, dummyEmail }) => {
      const core = sap?.ui?.getCore?.();
      if (!core) return false;
      const results = { lastName: false, firstName: false, email: false };

      // Helper: find input by label text
      function setFieldByLabel(labelText, value) {
        for (const id in core.mElements || {}) {
          const el = core.mElements[id];
          const lbl = el.getLabel?.() || el.getName?.() || "";
          const text = (typeof lbl === "string" ? lbl : lbl?.getText?.() || "").trim();
          if (text.toLowerCase().includes(labelText.toLowerCase())) {
            if (typeof el.setValue === "function") {
              el.setValue(value);
              el.fireChange?.({ value });
              return true;
            }
          }
        }
        return false;
      }

      results.lastName = setFieldByLabel("Last Name", dummyLastName);
      results.firstName = setFieldByLabel("First Name", "X");
      results.email = setFieldByLabel("E-Mail", dummyEmail) || setFieldByLabel("Email", dummyEmail);

      // Also try to clear non-mandatory fields
      for (const field of ["Phone", "Mobile", "Fax"]) {
        setFieldByLabel(field, "");
      }

      return results;
    }, { dummyLastName, dummyEmail });

    if (fieldsCleared && (fieldsCleared.lastName || fieldsCleared.email)) {
      console.log(`[S4-Clear] Fields cleared via UI5:`, fieldsCleared);
      return;
    }
    throw new Error("Could not clear fields via UI5 registry");
  }, `On the business user detail page, edit the personal details:
- Change "Last Name" to "${dummyLastName}"
- Change "First Name" to "X"
- Change "E-Mail" / "Email Address" to "${dummyEmail}"
- Clear "Phone" and "Mobile" fields if present
These fields may be in the General or Personal Information section. Click Edit first if needed.`,
  { credentials: creds });

  await page.waitForTimeout(1000);
  await verifyNoErrors(page, "clear-personal-data", creds);
}

/**
 * Remove all assigned business roles.
 */
async function removeAllRoles(page, workerId, creds) {
  console.log(`[S4-Clear] Removing business roles for ${workerId}...`);

  await withAIFallback(page, async () => {
    // Navigate to the "Assigned Business Roles" section/tab
    const roleTab = page.locator('[role="tab"], .sapMITBFilter, .sapMSegBBtn').filter({ hasText: /Role|Business Role/i }).first();
    if (await roleTab.isVisible({ timeout: 3000 })) {
      await roleTab.click();
      await page.waitForTimeout(1500);
      await waitForUI5Ready(page, 5000);
    }

    // Select all roles and delete
    // Strategy 1: Select All checkbox + Delete button
    let rolesFound = false;
    try {
      const selectAll = page.locator('[role="checkbox"]').filter({ hasText: /Select All/i }).first();
      if (await selectAll.isVisible({ timeout: 2000 })) {
        const checked = await selectAll.getAttribute("aria-checked");
        if (checked !== "true") await selectAll.click();
        rolesFound = true;
      }
    } catch {}

    // Strategy 2: UI5 table select all
    if (!rolesFound) {
      try {
        const selectAllDone = await page.evaluate(() => {
          const core = sap?.ui?.getCore?.();
          if (!core) return false;
          for (const id in core.mElements || {}) {
            const el = core.mElements[id];
            if (typeof el.selectAll === "function") {
              const items = el.getItems?.() || [];
              if (items.length > 0) {
                el.selectAll(true);
                return true;
              }
            }
          }
          return false;
        });
        if (selectAllDone) rolesFound = true;
      } catch {}
    }

    if (!rolesFound) {
      console.log(`[S4-Clear] No roles found or no select-all — may already be empty`);
      return;
    }

    // Click Delete/Remove button
    await page.waitForTimeout(500);
    for (const btnText of ["Delete", "Remove"]) {
      try {
        await clickUI5Button(page, btnText);
        console.log(`[S4-Clear] Clicked ${btnText} for roles`);
        await page.waitForTimeout(1000);
        // Confirm deletion if dialog appears
        for (const confirmText of ["Delete", "OK", "Yes", "Confirm"]) {
          try { await clickUI5Button(page, confirmText); break; } catch {}
        }
        return;
      } catch {}
    }
    throw new Error("Could not find Delete/Remove button for roles");
  }, `On the business user detail page for "${workerId}", navigate to the "Assigned Business Roles" tab/section. Select all roles using the "Select All" checkbox, then click the "Delete" or "Remove" button to remove all assigned business roles. If a confirmation dialog appears, confirm the deletion.`,
  { credentials: creds });

  await page.waitForTimeout(1000);
  await verifyNoErrors(page, "remove-roles", creds);
}

/**
 * Save changes on the business user detail page.
 */
async function saveChanges(page, workerId, creds) {
  console.log(`[S4-Clear] Saving changes for ${workerId}...`);
  await withAIFallback(page, async () => {
    await clickUI5Button(page, "Save");
  }, `Click the "Save" button to save all changes to business user "${workerId}".`,
  { credentials: creds });

  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
  await verifyNoErrors(page, "save", creds);
  console.log(`[S4-Clear] ✓ Saved changes for ${workerId}`);
}

/**
 * Navigate back to the list view.
 */
async function navigateBack(page, creds) {
  await withAIFallback(page, async () => {
    // Try browser back or back button in shell
    const backBtn = page.locator('[role="button"]').filter({ hasText: /Back/i }).first();
    if (await backBtn.isVisible({ timeout: 2000 })) {
      await backBtn.click();
      return;
    }
    // Try nav back button (arrow icon)
    const navBack = page.locator('.sapMNavBack, .sapUshellHeadItm, [icon="nav-back"], [icon="slim-arrow-left"]').first();
    if (await navBack.isVisible({ timeout: 2000 })) {
      await navBack.click();
      return;
    }
    await page.goBack();
  }, `Click the Back button or navigation arrow to return to the Maintain Business Users list.`,
  { credentials: creds });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
}

// ── Main ──────────────────────────────────────────────────────

export async function runS4UserClear({ job, step, users, connection }) {
  const page = await newPage();
  const connUser = connection.username || connection.user_name || "";
  const connPass = connection.password || "";
  const creds = { username: connUser, password: connPass };

  // Read user_configs from job config — these have per-user worker_id + run_s4/run_ias flags
  let userConfigs = [];
  try {
    const cfg = typeof job.config === "string" ? JSON.parse(job.config) : (job.config || {});
    userConfigs = (cfg.user_configs || []).filter(uc => uc.run_s4 !== false);
  } catch {}

  // Fall back to users array if no user_configs (backwards compat)
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

    // Step 1: Login
    console.log("[S4-Clear] Logging into S/4HANA...");
    const loggedIn = await loginToSystem(page, baseUrl, connUser, connPass);
    if (!loggedIn) throw new Error("Failed to login to S/4HANA");

    // Step 2: Navigate to Maintain Business Users
    console.log("[S4-Clear] Navigating to Maintain Business Users...");
    await navigateToApp(page, baseUrl, MAINTAIN_BU_APP);
    await screenshot(page, "s4-clear-maintain-bu");
    await verifyNoErrors(page, "navigate", creds);

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
        console.log(`[S4-Clear] [${label}] Processing ${wid}...`);

        // Search for user
        await searchUser(page, wid, creds);
        await screenshot(page, `s4-clear-search-${wid}`);

        // Open user detail
        await openUserDetail(page, wid, creds);
        await screenshot(page, `s4-clear-detail-${wid}`);

        // Click Edit if not already in edit mode
        try {
          const editBtn = page.locator('button, [role="button"]').filter({ hasText: /^Edit$/i }).first();
          if (await editBtn.isVisible({ timeout: 2000 })) {
            await editBtn.click();
            await page.waitForTimeout(1500);
            await waitForUI5Ready(page, 5000);
            console.log(`[S4-Clear] [${label}] Entered edit mode`);
          }
        } catch {}

        // Lock the user
        await lockUser(page, wid, creds);

        // Clear personal data
        await clearPersonalData(page, wid, creds);

        // Remove all business roles
        await removeAllRoles(page, wid, creds);

        // Save
        await saveChanges(page, wid, creds);
        await screenshot(page, `s4-clear-saved-${wid}`);

        // Navigate back to list for next user
        if (i < targetUsers.length - 1) {
          await navigateBack(page, creds);
        }

        cleared++;
        results.push({ worker_id: wid, status: "cleared" });
        console.log(`[S4-Clear] [${label}] ✓ User ${wid} cleared`);

      } catch (err) {
        console.error(`[S4-Clear] [${label}] ✗ Failed ${wid}: ${err.message}`);
        await screenshot(page, `s4-clear-error-${wid}`);
        failed++;
        results.push({ worker_id: wid, status: "failed", error: err.message });

        // Try to recover — navigate back to list
        try { await navigateBack(page, creds); } catch {}
        try {
          await navigateToApp(page, baseUrl, MAINTAIN_BU_APP);
          await page.waitForTimeout(2000);
        } catch {}
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
