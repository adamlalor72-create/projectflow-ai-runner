// DealFlow AI Runner — S/4 User Clear (Two-App Flow)
// App 1: Manage Workforce (WorkforcePerson-manage_v2) — clear personal data
// App 2: Maintain Business Users (BusinessUser-maintain) — check lock, remove roles if unlocked, lock
//
// If user is already locked in Maintain Business Users, skip role removal (can't edit when locked).

import {
  newPage, loginToSystem, navigateToApp, waitForUI5Ready,
  clickUI5Button, screenshot
} from '../lib/browser.js';
import { aiResolve, withAIFallback } from '../lib/ai-agent.js';

const MW_APP = "WorkforcePerson-manage_v2";
const MBU_APP = "BusinessUser-maintain";

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

// ── Manage Workforce helpers ─────────────────────────────────

async function mwSearchUser(page, workerId, creds) {
  console.log(`[S4-Clear] [MW] Searching for ${workerId}...`);
  await withAIFallback(page, async () => {
    const searchInput = page.locator('input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.click();
      await searchInput.fill("");
      await searchInput.fill(workerId);
      await searchInput.press("Enter");
      return;
    }
    throw new Error("Search input not found");
  }, `Find the search bar in Manage Workforce and search for worker ID "${workerId}".`,
  { credentials: creds });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
}

async function mwClickUser(page, workerId, creds) {
  console.log(`[S4-Clear] [MW] Opening ${workerId}...`);
  await withAIFallback(page, async () => {
    const btn = page.locator(`button:has-text("${workerId}")`).first();
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click();
      return;
    }
    throw new Error(`Worker ID button not found for ${workerId}`);
  }, `Click on the worker ID "${workerId}" in the list to open their detail panel.`,
  { credentials: creds });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
}

async function mwClickEdit(page, creds) {
  console.log(`[S4-Clear] [MW] Entering edit mode...`);
  await withAIFallback(page, async () => {
    const editBtn = page.locator('button:has-text("Edit")').first();
    if (await editBtn.isVisible({ timeout: 3000 })) {
      await editBtn.click();
      return;
    }
    throw new Error("Edit button not found");
  }, `Click the "Edit" button on the worker detail page to enter edit mode.`,
  { credentials: creds });
  await page.waitForTimeout(1500);
  await waitForUI5Ready(page, 5000);
}

async function mwClearPersonalData(page, workerId, creds) {
  const dummyEmail = `cleared.${workerId.toLowerCase()}@dummy.com`;
  console.log(`[S4-Clear] [MW] Clearing personal data → Last Name: "Cleared", Email: "${dummyEmail}"...`);

  await withAIFallback(page, async () => {
    // Use page.evaluate to find and set UI5 input fields by their label associations
    const result = await page.evaluate(({ dummyEmail }) => {
      const core = sap?.ui?.getCore?.();
      if (!core) return { success: false, reason: "no_sap_core" };

      const results = {};
      // Strategy: iterate all UI5 elements, find SmartField or Input with matching label
      for (const id in core.mElements || {}) {
        const el = core.mElements[id];
        // Check SmartField / Input getValue/setValue
        if (typeof el.setValue !== "function" || typeof el.getValue !== "function") continue;
        const label = el.getTextLabel?.() || el._sLabel || "";
        const binding = el.getBindingPath?.("value") || "";
        const domRef = el.getDomRef?.();
        const ariaLabel = domRef?.getAttribute?.("aria-label") || "";
        const placeholder = domRef?.getAttribute?.("placeholder") || "";
        const combined = `${label}|${binding}|${ariaLabel}|${placeholder}`.toLowerCase();

        if (combined.includes("last name") || combined.includes("lastname") || binding.includes("LastName")) {
          el.setValue("Cleared");
          el.fireChange?.({ value: "Cleared" });
          results.lastName = true;
        } else if (combined.includes("first name") || combined.includes("firstname") || binding.includes("FirstName")) {
          el.setValue("");
          el.fireChange?.({ value: "" });
          results.firstName = true;
        } else if ((combined.includes("email") || combined.includes("e-mail") || binding.includes("Email")) && !combined.includes("validate")) {
          el.setValue(dummyEmail);
          el.fireChange?.({ value: dummyEmail });
          results.email = true;
        }
      }
      return { success: !!(results.lastName || results.email), ...results };
    }, { dummyEmail });

    if (result?.success) {
      console.log(`[S4-Clear] [MW] Fields cleared via UI5:`, result);
      return;
    }

    // Fallback: try finding inputs by visible label text proximity
    const inputs = await page.$$('input[type="text"], input:not([type])');
    for (const input of inputs) {
      if (!(await input.isVisible().catch(() => false))) continue;
      // Check preceding label
      const parent = await input.evaluateHandle(el => el.closest('[class*="Field"], [class*="form"]'));
      const text = await parent.evaluate(el => el?.textContent || "").catch(() => "");
      const val = await input.inputValue().catch(() => "");
      if (text.toLowerCase().includes("last name")) {
        await input.fill("Cleared");
        await input.dispatchEvent("change");
      } else if (text.toLowerCase().includes("first name")) {
        await input.fill("");
        await input.dispatchEvent("change");
      } else if (text.toLowerCase().includes("email") || text.toLowerCase().includes("e-mail")) {
        await input.fill(dummyEmail);
        await input.dispatchEvent("change");
      }
    }
  }, `On the Manage Workforce edit page, change the personal details:
- Clear "First Name" (make it empty)
- Change "Last Name" to "Cleared"
- Change "Email" to "${dummyEmail}"
These fields are in the Personal Information section on the right side.`,
  { credentials: creds });

  await page.waitForTimeout(1000);
  await verifyNoErrors(page, "mw-clear-personal", creds);
}

async function mwSave(page, creds) {
  console.log(`[S4-Clear] [MW] Saving...`);
  await withAIFallback(page, async () => {
    await clickUI5Button(page, "Save");
  }, `Click the "Save" button to save the changes.`, { credentials: creds });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
  await verifyNoErrors(page, "mw-save", creds);
}

// ── Maintain Business Users helpers ──────────────────────────

async function mbuSearchUser(page, workerId, creds) {
  console.log(`[S4-Clear] [MBU] Searching for ${workerId}...`);
  await withAIFallback(page, async () => {
    // MBU has a search field at the top
    const searchInputs = await page.$$('input[type="search"], input[type="text"]');
    for (const input of searchInputs) {
      if (await input.isVisible().catch(() => false)) {
        const ph = await input.getAttribute("placeholder").catch(() => "");
        if (ph?.toLowerCase().includes("search") || ph === "") {
          await input.click();
          await input.fill(workerId);
          await input.press("Enter");
          console.log(`[S4-Clear] [MBU] Searched for ${workerId}`);
          return;
        }
      }
    }
    throw new Error("Search input not found in MBU");
  }, `Search for user "${workerId}" in the Maintain Business Users search bar.`,
  { credentials: creds });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
}

async function mbuClickUser(page, workerId, creds) {
  console.log(`[S4-Clear] [MBU] Opening user ${workerId}...`);
  await withAIFallback(page, async () => {
    // Click on the row containing the worker ID
    const link = page.locator(`a:has-text("${workerId}"), button:has-text("${workerId}"), td:has-text("${workerId}")`).first();
    if (await link.isVisible({ timeout: 3000 })) {
      await link.click();
      return;
    }
    // Try any row text
    const rows = await page.$$('tr, [role="row"], .sapMLIB');
    for (const row of rows) {
      const text = await row.textContent().catch(() => "");
      if (text.includes(workerId)) {
        await row.click();
        return;
      }
    }
    throw new Error(`User ${workerId} not found in MBU list`);
  }, `Click on user "${workerId}" in the Maintain Business Users list to open their detail.`,
  { credentials: creds });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
}

/**
 * Check if the "Locked" checkbox is already checked.
 * Returns true if locked, false if unlocked.
 */
async function mbuIsLocked(page, creds) {
  try {
    // Look for "Locked" checkbox via UI5
    const locked = await page.evaluate(() => {
      const core = sap?.ui?.getCore?.();
      if (!core) return null;
      for (const id in core.mElements || {}) {
        const el = core.mElements[id];
        const text = (el.getText?.() || el.getLabel?.() || "").toString().toLowerCase();
        if (text.includes("locked") || text.includes("lock")) {
          if (typeof el.getSelected === "function") return el.getSelected();
          if (typeof el.getState === "function") return el.getState() === true;
        }
      }
      return null;
    });
    if (locked !== null) {
      console.log(`[S4-Clear] [MBU] Lock state: ${locked ? "LOCKED" : "UNLOCKED"}`);
      return locked;
    }
    // Fallback: check aria-checked on checkboxes near "Locked" text
    const cb = page.locator('[role="checkbox"]').filter({ hasText: /Lock/i }).first();
    if (await cb.isVisible({ timeout: 2000 })) {
      const checked = await cb.getAttribute("aria-checked");
      const isLocked = checked === "true";
      console.log(`[S4-Clear] [MBU] Lock state (aria): ${isLocked ? "LOCKED" : "UNLOCKED"}`);
      return isLocked;
    }
  } catch {}
  console.warn(`[S4-Clear] [MBU] Could not determine lock state, assuming unlocked`);
  return false;
}

/**
 * Remove all assigned business roles: select all checkbox → Remove button.
 */
async function mbuRemoveRoles(page, workerId, creds) {
  console.log(`[S4-Clear] [MBU] Removing business roles...`);

  await withAIFallback(page, async () => {
    // Find the "Assigned Business Roles" section
    // The select-all checkbox is the one in the header row next to "Business Role"
    const headerCb = page.locator('th [role="checkbox"], thead [role="checkbox"], .sapMCb').filter({ hasText: /Business Role/i }).first();

    // Strategy 1: click the checkbox in the header of the roles table
    let selectAllClicked = false;
    try {
      // Find checkbox that's a sibling/peer of "Business Role" column header
      const allCbs = await page.$$('[role="checkbox"]');
      for (const cb of allCbs) {
        const parent = await cb.evaluateHandle(el => el.closest('tr, thead, .sapMListTblHeader'));
        const parentText = await parent.evaluate(el => el?.textContent || "").catch(() => "");
        if (parentText.includes("Business Role")) {
          const checked = await cb.getAttribute("aria-checked");
          if (checked !== "true") await cb.click();
          selectAllClicked = true;
          console.log(`[S4-Clear] [MBU] Select-all checkbox clicked`);
          break;
        }
      }
    } catch {}

    if (!selectAllClicked) {
      // Strategy 2: UI5 registry — find the roles table and selectAll
      const done = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        for (const id in core.mElements || {}) {
          const el = core.mElements[id];
          const heading = el.getHeaderText?.() || el.getTitle?.() || "";
          if (heading.toString().includes("Assigned Business Roles") || heading.toString().includes("Business Roles")) {
            if (typeof el.selectAll === "function") {
              el.selectAll(true);
              return true;
            }
          }
        }
        return false;
      });
      if (done) {
        selectAllClicked = true;
        console.log(`[S4-Clear] [MBU] Select-all via UI5 registry`);
      }
    }

    if (!selectAllClicked) {
      console.log(`[S4-Clear] [MBU] No roles to remove or select-all not found`);
      return;
    }

    // Click Remove button (it lights up after selecting)
    await page.waitForTimeout(500);
    const removeBtn = page.locator('button:has-text("Remove"), [role="button"]:has-text("Remove")').first();
    if (await removeBtn.isVisible({ timeout: 3000 })) {
      const disabled = await removeBtn.getAttribute("aria-disabled");
      if (disabled !== "true") {
        await removeBtn.click();
        console.log(`[S4-Clear] [MBU] Clicked Remove`);
      } else {
        console.log(`[S4-Clear] [MBU] Remove button disabled — no roles?`);
      }
    }
  }, `In the "Assigned Business Roles" section, click the checkbox next to "Business Role" header to select all roles, then click the "Remove" button that becomes active.`,
  { credentials: creds });

  await page.waitForTimeout(1000);
  await verifyNoErrors(page, "mbu-remove-roles", creds);
}

/**
 * Tick the "Locked" checkbox.
 */
async function mbuSetLocked(page, creds) {
  console.log(`[S4-Clear] [MBU] Setting lock...`);
  await withAIFallback(page, async () => {
    // Try UI5 first
    const done = await page.evaluate(() => {
      const core = sap?.ui?.getCore?.();
      if (!core) return false;
      for (const id in core.mElements || {}) {
        const el = core.mElements[id];
        const text = (el.getText?.() || el.getLabel?.() || "").toString().toLowerCase();
        if (text.includes("locked") || text.includes("lock")) {
          if (typeof el.setSelected === "function" && !el.getSelected()) {
            el.setSelected(true);
            el.fireSelect?.({ selected: true });
            return true;
          }
        }
      }
      return false;
    });
    if (done) {
      console.log(`[S4-Clear] [MBU] Locked via UI5`);
      return;
    }
    // Fallback: click the checkbox
    const cb = page.locator('[role="checkbox"]').filter({ hasText: /Lock/i }).first();
    if (await cb.isVisible({ timeout: 2000 })) {
      const checked = await cb.getAttribute("aria-checked");
      if (checked !== "true") await cb.click();
      return;
    }
    throw new Error("Lock checkbox not found");
  }, `Find the "Locked" checkbox on the business user detail page and tick it to lock the user.`,
  { credentials: creds });
  await page.waitForTimeout(500);
}

async function mbuSave(page, creds) {
  console.log(`[S4-Clear] [MBU] Saving...`);
  await withAIFallback(page, async () => {
    await clickUI5Button(page, "Save");
  }, `Click the "Save" button to save changes.`, { credentials: creds });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page, 10000);
  await verifyNoErrors(page, "mbu-save", creds);
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

        // ── Part 1: Manage Workforce — clear personal data ──
        console.log(`[S4-Clear] [${label}] Part 1: Manage Workforce`);
        await navigateToApp(page, baseUrl, MW_APP);
        await page.waitForTimeout(2000);
        await waitForUI5Ready(page, 10000);
        await screenshot(page, `s4-clear-mw-list-${wid}`);

        await mwSearchUser(page, wid, creds);
        await mwClickUser(page, wid, creds);
        await screenshot(page, `s4-clear-mw-detail-${wid}`);
        await mwClickEdit(page, creds);
        await mwClearPersonalData(page, wid, creds);
        await mwSave(page, creds);
        await screenshot(page, `s4-clear-mw-saved-${wid}`);
        console.log(`[S4-Clear] [${label}] ✓ Personal data cleared in MW`);

        // ── Part 2: Maintain Business Users — lock + remove roles ──
        console.log(`[S4-Clear] [${label}] Part 2: Maintain Business Users`);
        await navigateToApp(page, baseUrl, MBU_APP);
        await page.waitForTimeout(2000);
        await waitForUI5Ready(page, 10000);
        await screenshot(page, `s4-clear-mbu-list-${wid}`);

        await mbuSearchUser(page, wid, creds);
        await mbuClickUser(page, wid, creds);
        await screenshot(page, `s4-clear-mbu-detail-${wid}`);

        // Check lock state
        const alreadyLocked = await mbuIsLocked(page, creds);
        if (alreadyLocked) {
          console.log(`[S4-Clear] [${label}] User already locked — skipping role removal`);
        } else {
          // Remove roles first (can only do this while unlocked)
          await mbuRemoveRoles(page, wid, creds);
          // Then lock
          await mbuSetLocked(page, creds);
          // Save
          await mbuSave(page, creds);
          await screenshot(page, `s4-clear-mbu-saved-${wid}`);
        }

        cleared++;
        results.push({ worker_id: wid, status: "cleared", locked: alreadyLocked ? "already" : "set" });
        console.log(`[S4-Clear] [${label}] ✓ User ${wid} fully cleared`);

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
