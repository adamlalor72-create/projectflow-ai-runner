// DealFlow AI Runner — S/4 Business Role Assignment Upload
// Navigates to Maintain Business Users and uploads role CSV
// AI vision is engaged proactively at every step for error recovery

import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import {
  newPage, loginToSystem, navigateToApp, waitForUI5Ready,
  clickUI5Button, getUI5FileInput, screenshot
} from '../lib/browser.js';
import { generateRoleCSV } from '../lib/api.js';
import { aiResolve, withAIFallback, tryLearnedStrategies } from '../lib/ai-agent.js';

/**
 * After each step, check for unexpected error dialogs and recover via AI.
 */
async function verifyNoErrors(page, stepLabel, creds) {
  try {
    const errorPopup = await page.locator('.sapMMessageDialog, [role="alertdialog"], .sapMMsgBox').first().isVisible({ timeout: 1500 }).catch(() => false);
    if (errorPopup) {
      console.warn(`[S4-Roles] Unexpected error dialog after ${stepLabel} — engaging AI to recover...`);
      await screenshot(page, `s4-roles-error-at-${stepLabel}`);
      await aiResolve(page,
        `An unexpected error dialog or message box appeared on the S/4HANA screen after ${stepLabel}. Read the error, dismiss it, and get back to a usable state. Click OK, Close, or Cancel as appropriate.`,
        { maxAttempts: 3, credentials: creds }
      );
    }
  } catch {}
}

export async function runS4RoleAssignment({ job, step, users, roles, connection }) {
  const page = await newPage();
  let csvPath = null;
  const connUser = connection.username || connection.user_name || "";
  const connPass = connection.password || "";
  const creds = { username: connUser, password: connPass };

  try {
    const usersWithRoles = users.filter(u => roles.some(r => r.project_user_id === u.id));
    if (usersWithRoles.length === 0) {
      console.log("[S4-Roles] No users have role assignments — skipping.");
      return { skipped: true, reason: "No role assignments found" };
    }

    // Log role data for diagnostics
    console.log(`[S4-Roles] ${usersWithRoles.length} user(s) with ${roles.length} role assignment(s)`);
    usersWithRoles.forEach(u => {
      const ur = roles.filter(r => r.project_user_id === u.id);
      console.log(`[S4-Roles]   ${u.user_name || u.worker_id || "?"} (${u.email}): ${ur.map(r => r.role_id).join(", ")}`);
    });

    const baseUrl = connection.system_url.replace(/\/$/, "");

    // Step 1: Login
    console.log("[S4-Roles] Logging into S/4HANA...");
    const loggedIn = await loginToSystem(page, baseUrl, connUser, connPass);
    if (!loggedIn) throw new Error("Failed to login to S/4HANA");

    // Step 2: Navigate to Maintain Business Users
    console.log("[S4-Roles] Navigating to Maintain Business Users...");
    await navigateToApp(page, baseUrl, "BusinessUser-maintain");
    await screenshot(page, "s4-roles-maintain-users");
    await verifyNoErrors(page, "navigate", creds);

    // Step 3: Generate role CSV FIRST (before opening dialog)
    console.log(`[S4-Roles] Generating role CSV for ${usersWithRoles.length} users...`);
    const csv = generateRoleCSV(users, roles);
    csvPath = path.join(process.cwd(), `_temp_roles_${job.id.slice(0, 8)}.csv`);
    await writeFile(csvPath, csv, "utf8");
    // Log first few lines for diagnostics
    const csvLines = csv.split("\n");
    console.log(`[S4-Roles] CSV: ${csvLines.length} lines (1 header + ${csvLines.length - 1} data)`);
    csvLines.slice(0, 5).forEach((l, i) => console.log(`[S4-Roles]   CSV[${i}]: ${l.trim().slice(0, 120)}`));
    if (csvLines.length < 2 || (csvLines.length === 2 && csvLines[1].trim() === "")) {
      throw new Error("Role CSV has no data rows — check that users have roles assigned in User Manager");
    }

    // Step 4: Click "Upload" toolbar button (opens dropdown menu)
    console.log("[S4-Roles] Clicking Upload toolbar button...");
    await withAIFallback(page, async () => {
      await clickUI5Button(page, "Upload");
    }, "Click the 'Upload' button in the top toolbar of Maintain Business Users. It opens a dropdown menu with options.", { credentials: creds });
    await page.waitForTimeout(1500);
    await screenshot(page, "s4-roles-upload-menu");

    // Step 5: Click "Upload User Role Assignments" from the dropdown
    console.log("[S4-Roles] Clicking 'Upload User Role Assignments' menu item...");
    let menuClicked = false;

    // Strategy 1: UI5 control registry — any element with matching text
    try {
      menuClicked = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        const elements = core.mElements || {};
        for (const id in elements) {
          const el = elements[id];
          const text = el.getText?.() || el.getTitle?.() || "";
          if (text.includes("Upload User Role") || text.includes("Upload Business Role")) {
            const dom = el.getDomRef?.();
            if (dom) { dom.click(); return true; }
            if (typeof el.firePress === "function") { el.firePress(); return true; }
          }
        }
        return false;
      });
      if (menuClicked) console.log("[S4-Roles] Clicked menu item via UI5 registry.");
    } catch {}

    // Strategy 2: Text locator
    if (!menuClicked) {
      for (const pattern of ["Upload User Role Assignments", "Upload Business Role"]) {
        try {
          const item = page.locator(`text=${pattern}`).first();
          if (await item.isVisible({ timeout: 2000 })) {
            await item.click({ timeout: 5000 });
            menuClicked = true;
            console.log(`[S4-Roles] Clicked menu item via text: "${pattern}"`);
            break;
          }
        } catch {}
      }
    }

    // Strategy 3: DOM scan for menu items
    if (!menuClicked) {
      try {
        const items = await page.$$('[role="menuitem"], [role="listitem"], .sapMSLI, .sapMLIB, li');
        for (const item of items) {
          const text = await item.textContent().catch(() => "");
          if (text.includes("Role Assignment") || text.includes("Role Assign")) {
            await item.click();
            menuClicked = true;
            console.log("[S4-Roles] Clicked menu item via DOM scan:", text.trim().slice(0, 60));
            break;
          }
        }
      } catch {}
    }

    // Strategy 4: AI vision
    if (!menuClicked) {
      console.warn("[S4-Roles] Engaging AI to find menu item...");
      await aiResolve(page,
        `A dropdown menu appeared after clicking Upload. I need to click "Upload User Role Assignments" from this menu. Click it now.`,
        { maxAttempts: 5, credentials: creds }
      );
    }

    await page.waitForTimeout(2000);

    // Detect dialog using multiple approaches
    const checkDialogOpen = async (timeout = 3000) => {
      // Check 1: Standard dialog selectors
      const sel = await page.locator('[role="dialog"], .sapMDialog, .sapMPopover, .sapUiDlg, .sapMDialogScrollCont').first().isVisible({ timeout }).catch(() => false);
      if (sel) return true;
      // Check 2: Look for dialog-specific content (radio buttons text)
      const content = await page.locator('text=/Add to Existing.*Role|Save User Role|Choose a CSV/i').first().isVisible({ timeout: 1500 }).catch(() => false);
      if (content) return true;
      // Check 3: UI5 dialog in control registry
      const ui5 = await page.evaluate(() => {
        try {
          const core = sap?.ui?.getCore?.();
          if (!core) return false;
          for (const id in core.mElements || {}) {
            const el = core.mElements[id];
            const meta = el.getMetadata?.()?.getName?.() || "";
            if (meta === "sap.m.Dialog" || meta === "sap.m.Popover" || meta === "sap.ui.commons.Dialog") {
              if (el.isOpen?.()) return true;
            }
          }
        } catch {}
        return false;
      }).catch(() => false);
      return ui5;
    };

    let dialogOpened = await checkDialogOpen(5000);
    if (!dialogOpened) {
      // One more AI attempt to get the dialog open
      console.warn("[S4-Roles] Dialog not detected — AI attempting recovery...");
      await aiResolve(page,
        `I need the "Save User Role Assignments" dialog to be open. It should have radio buttons for "Add to Existing" and "Overwrite", plus a Browse button. If the dialog is not visible, try clicking Upload > Upload User Role Assignments again.`,
        { maxAttempts: 5, credentials: creds }
      );
      dialogOpened = await checkDialogOpen(3000);
    }
    if (!dialogOpened) throw new Error("Upload User Role Assignments dialog did not open");
    await page.waitForTimeout(1000);
    await screenshot(page, "s4-roles-dialog-open");

    // Step 6: Select "Add to Existing User Role Assignments" radio
    console.log("[S4-Roles] Selecting 'Add to Existing' radio...");
    try {
      const radioSelected = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        for (const id in core.mElements || {}) {
          const el = core.mElements[id];
          if (el.getMetadata?.()?.getName?.() === "sap.m.RadioButton") {
            if ((el.getText?.() || "").includes("Add to Existing")) {
              el.setSelected(true);
              el.fireSelect?.({ selected: true });
              return true;
            }
          }
        }
        return false;
      });
      if (radioSelected) {
        console.log("[S4-Roles] Selected 'Add to Existing' via UI5 registry.");
      } else {
        const radio = page.locator('text=/Add to Existing/i').first();
        if (await radio.isVisible({ timeout: 2000 })) {
          await radio.click();
          console.log("[S4-Roles] Selected 'Add to Existing' via text click.");
        }
      }
    } catch (e) {
      console.warn("[S4-Roles] Radio selection failed (may be default):", e.message);
    }
    await page.waitForTimeout(500);

    // Step 7: Upload CSV file into the dialog
    console.log("[S4-Roles] Uploading role CSV...");
    let uploaded = false;

    // Strategy 1: Find any file input in DOM and expose it
    try {
      await page.evaluate(() => {
        document.querySelectorAll('input[type="file"]').forEach(input => {
          input.style.display = "block";
          input.style.visibility = "visible";
          input.style.opacity = "1";
          input.style.width = "1px";
          input.style.height = "1px";
        });
      });
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(csvPath, { timeout: 10000 });
        console.log("[S4-Roles] Uploaded via exposed file input.");
        uploaded = true;
      }
    } catch (e) { console.warn("[S4-Roles] File input strategy failed:", e.message); }

    // Strategy 2: UI5 FileUploader
    if (!uploaded) {
      try {
        const fileInput = await getUI5FileInput(page);
        await fileInput.setInputFiles(csvPath, { timeout: 10000 });
        console.log("[S4-Roles] Uploaded via UI5 FileUploader.");
        uploaded = true;
      } catch (e) { console.warn("[S4-Roles] UI5 FileUploader failed:", e.message); }
    }

    // Strategy 3: AI vision — let it find the Browse button
    if (!uploaded) {
      console.warn("[S4-Roles] Engaging AI for file upload...");
      await aiResolve(page,
        `The "Save User Role Assignments" dialog is open. I need to upload a CSV file. The file path is: ${csvPath}. Find the file input (hidden behind "Browse..." button) and upload it.`,
        { maxAttempts: 5, credentials: creds, taskType: "role_file_upload", learnContext: { csvPath } }
      );
      // Retry file input after AI
      try {
        const inputs = await page.$$('input[type="file"]');
        if (inputs.length > 0) {
          await inputs[0].setInputFiles(csvPath, { timeout: 10000 });
          uploaded = true;
        }
      } catch {}
    }

    if (!uploaded) throw new Error("Could not upload role CSV");
    await page.waitForTimeout(2000);
    await screenshot(page, "s4-roles-file-uploaded");
    await verifyNoErrors(page, "file-upload", creds);

    // Step 8: Click Upload button in the dialog footer (not the toolbar one)
    console.log("[S4-Roles] Clicking Upload in dialog footer...");
    await withAIFallback(page, async () => {
      // Try dialog-scoped buttons first
      const dialogBtns = await page.$$('[role="dialog"] button, .sapMDialog button, .sapMDialogFooter button');
      for (const btn of dialogBtns) {
        const text = await btn.textContent().catch(() => "");
        if (text.trim() === "Upload" || text.trim() === "OK") {
          await btn.click();
          console.log(`[S4-Roles] Clicked dialog footer button: "${text.trim()}"`);
          return;
        }
      }
      // Fallback to UI5 button
      await clickUI5Button(page, "Upload");
    }, "Click the 'Upload' button in the bottom-right corner of the dialog to start the role assignment upload. NOT the Cancel button.", { credentials: creds });

    // Step 9: Wait for S4 to process and show results
    console.log("[S4-Roles] Waiting for upload to process...");
    await page.waitForTimeout(5000);
    await waitForUI5Ready(page, 30000);
    await screenshot(page, "s4-roles-result");

    // Step 10: Check result — look for the validation/result screen
    console.log("[S4-Roles] Checking upload result...");
    let resultSummary = "";
    try {
      // The result screen shows tabs: Valid/Invalid Business Users, Valid/Invalid Roles
      const validUsers = await page.locator('text=/Valid Business Users/i').first().textContent({ timeout: 3000 }).catch(() => "");
      const invalidUsers = await page.locator('text=/Invalid Business Users/i').first().textContent({ timeout: 2000 }).catch(() => "");
      resultSummary = `${validUsers} | ${invalidUsers}`;
      console.log(`[S4-Roles] Result: ${resultSummary}`);

      if (invalidUsers.includes("0") || !invalidUsers) {
        console.log("[S4-Roles] No invalid users — looking good.");
      } else {
        console.warn("[S4-Roles] Some invalid users detected — check S4 screen.");
      }
    } catch {}

    // Step 11: Click the final Upload button on the result/validation screen
    // This is a page-level button (bottom-right), NOT inside a dialog
    console.log("[S4-Roles] Clicking final Upload button on result screen...");
    await screenshot(page, "s4-roles-before-final-upload");
    await withAIFallback(page, async () => {
      // Strategy 1: UI5 registry — find Upload button that is NOT in a dialog
      const clicked = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        const elements = core.mElements || {};
        // Find all Upload buttons, prefer the one with "emphasized" or "Accept" type
        let candidates = [];
        for (const id in elements) {
          const el = elements[id];
          if (el?.getMetadata?.()?.getName?.() === "sap.m.Button" && el.getText?.() === "Upload" && el.getVisible?.()) {
            candidates.push({ id, type: el.getType?.() || "", el });
          }
        }
        // Prefer Emphasized button (the primary action)
        const emphasized = candidates.find(c => c.type === "Emphasized" || c.type === "Accept");
        const target = emphasized || candidates[candidates.length - 1]; // last one = bottom of page
        if (target) { target.el.firePress?.(); return true; }
        return false;
      });
      if (clicked) { console.log("[S4-Roles] Clicked final Upload via UI5 registry."); return; }

      // Strategy 2: Find the bottom-right Upload button by position
      const btns = await page.$$('button, [role="button"]');
      let bestBtn = null, bestY = 0;
      for (const b of btns) {
        const text = await b.textContent().catch(() => "");
        if (text.trim() === "Upload") {
          const box = await b.boundingBox().catch(() => null);
          if (box && box.y > bestY) { bestY = box.y; bestBtn = b; }
        }
      }
      if (bestBtn) {
        await bestBtn.click();
        console.log("[S4-Roles] Clicked final Upload via position (bottom-most).");
        return;
      }
      throw new Error("Could not find final Upload button");
    }, "The validation screen is showing with tabs (Valid/Invalid Business Users, Valid/Invalid Roles). Click the blue 'Upload' button in the bottom-right corner of the page to confirm and complete the role upload. Do NOT click Cancel.", { credentials: creds });

    await page.waitForTimeout(5000);
    await waitForUI5Ready(page, 15000);
    await screenshot(page, "s4-roles-after-final-upload");

    // Step 12: Dismiss any remaining dialogs
    await screenshot(page, "s4-roles-final");
    for (const btnText of ["Close", "OK", "Cancel"]) {
      try {
        await clickUI5Button(page, btnText);
        await page.waitForTimeout(1000);
        break;
      } catch {}
    }

    console.log(`[S4-Roles] Completed. ${roles.length} role(s) for ${usersWithRoles.length} user(s).`);
    return {
      users_with_roles: usersWithRoles.length,
      total_roles: roles.length,
      result_summary: resultSummary,
      timestamp: new Date().toISOString(),
    };

  } catch (err) {
    await screenshot(page, "s4-roles-error");
    throw err;
  } finally {
    if (csvPath) await unlink(csvPath).catch(() => {});
    await page.close().catch(() => {});
  }
}
