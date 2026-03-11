// DealFlow AI Runner — S/4 Business Role Assignment Upload
// Navigates to Maintain Business Users and uploads role CSV via UI5-aware helpers

import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import {
  newPage, loginToSystem, navigateToApp, waitForUI5Ready,
  clickUI5Button, getUI5FileInput, screenshot
} from '../lib/browser.js';
import { generateRoleCSV } from '../lib/api.js';
import { withAIFallback, tryLearnedStrategies } from '../lib/ai-agent.js';

export async function runS4RoleAssignment({ job, step, users, roles, connection }) {
  const page = await newPage();
  let csvPath = null;
  const creds = { username: connection.username, password: connection.password };

  try {
    const usersWithRoles = users.filter(u => roles.some(r => r.project_user_id === u.id));
    if (usersWithRoles.length === 0) {
      console.log("[S4-Roles] No users have role assignments — skipping.");
      return { skipped: true, reason: "No role assignments found" };
    }

    const baseUrl = connection.system_url.replace(/\/$/, "");

    // Step 1: Login
    console.log("[S4-Roles] Logging into S/4HANA...");
    const loggedIn = await loginToSystem(page, baseUrl, connection.username, connection.password);
    if (!loggedIn) throw new Error("Failed to login to S/4HANA");

    // Step 2: Navigate to Maintain Business Users
    console.log("[S4-Roles] Navigating to Maintain Business Users...");
    await navigateToApp(page, baseUrl, "BusinessUser-maintain");
    await screenshot(page, "s4-roles-maintain-users");

    // Step 3: Two-click menu flow — "Upload" toolbar button → "Upload User Role Assignments" menu item
    console.log("[S4-Roles] Step 3a: Clicking Upload toolbar button...");
    await withAIFallback(page, async () => {
      await clickUI5Button(page, "Upload");
    }, "Click the 'Upload' button in the toolbar of Maintain Business Users (it opens a dropdown menu).", { credentials: creds });
    await page.waitForTimeout(1500);
    await screenshot(page, "s4-roles-upload-menu");

    // Step 3b: Click "Upload User Role Assignments" from the dropdown menu
    console.log("[S4-Roles] Step 3b: Clicking 'Upload User Role Assignments' menu item...");
    let menuClicked = false;

    // Strategy 1: UI5 menu item by text
    try {
      menuClicked = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        const elements = core.mElements || {};
        for (const id in elements) {
          const el = elements[id];
          const meta = el.getMetadata?.()?.getName?.() || "";
          const text = el.getText?.() || el.getTitle?.() || "";
          if (text.includes("Upload User Role Assignments") || text.includes("Upload Business Role Assignments")) {
            if (typeof el.firePress === "function") el.firePress();
            else if (typeof el.fireItemPress === "function") el.fireItemPress();
            else { const dom = el.getDomRef?.(); if (dom) dom.click(); }
            return true;
          }
        }
        return false;
      });
      if (menuClicked) console.log("[S4-Roles] Clicked menu item via UI5 registry.");
    } catch {}

    // Strategy 2: Text locator for menu item
    if (!menuClicked) {
      try {
        const item = page.locator('text=/Upload User Role Assignments|Upload Business Role/i').first();
        if (await item.isVisible({ timeout: 3000 })) {
          await item.click({ timeout: 5000 });
          menuClicked = true;
          console.log("[S4-Roles] Clicked menu item via text locator.");
        }
      } catch {}
    }

    // Strategy 3: Any list item / menu item containing the text
    if (!menuClicked) {
      try {
        const items = await page.$$('[role="menuitem"], [role="listitem"], .sapMSLI, .sapMLIB, .sapMBtn');
        for (const item of items) {
          const text = await item.textContent().catch(() => "");
          if (text.includes("Role Assignments") || text.includes("Role Assignment")) {
            await item.click();
            menuClicked = true;
            console.log("[S4-Roles] Clicked menu item via DOM scan:", text.trim().slice(0, 60));
            break;
          }
        }
      } catch {}
    }

    // Strategy 4: AI fallback
    if (!menuClicked) {
      console.warn("[S4-Roles] Coded strategies failed for menu item — engaging AI...");
      await withAIFallback(page, async () => { throw new Error("need AI"); },
        `A dropdown menu is showing after clicking Upload. Click the menu item "Upload User Role Assignments" (not just "Upload").`,
        { credentials: creds, taskType: "role_upload_menu_item" }
      );
    }

    await page.waitForTimeout(2000);

    // Verify dialog opened
    let dialogOpened = await page.locator('[role="dialog"], .sapMDialog').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!dialogOpened) throw new Error("Upload User Role Assignments dialog did not open");
    await page.waitForTimeout(1500);
    await screenshot(page, "s4-roles-upload-dialog");

    // Step 3c: Ensure "Add to Existing User Role Assignments" radio is selected
    console.log("[S4-Roles] Step 3c: Selecting 'Add to Existing' radio...");
    try {
      // Try UI5 RadioButton with matching text
      const radioSelected = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        const elements = core.mElements || {};
        for (const id in elements) {
          const el = elements[id];
          const meta = el.getMetadata?.()?.getName?.() || "";
          if (meta === "sap.m.RadioButton") {
            const text = el.getText?.() || "";
            if (text.includes("Add to Existing")) {
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
        // Fallback: click text
        const radio = page.locator('text=/Add to Existing/i').first();
        if (await radio.isVisible({ timeout: 2000 })) {
          await radio.click();
          console.log("[S4-Roles] Selected 'Add to Existing' via text click.");
        }
      }
    } catch (e) {
      console.warn("[S4-Roles] Could not select radio (may already be default):", e.message);
    }
    await page.waitForTimeout(500);
    await screenshot(page, "s4-roles-radio-selected");

    // Step 4: Generate role CSV
    console.log(`[S4-Roles] Generating role CSV for ${usersWithRoles.length} users...`);
    const csv = generateRoleCSV(users, roles);
    csvPath = path.join(process.cwd(), `_temp_roles_${job.id.slice(0, 8)}.csv`);
    await writeFile(csvPath, csv, "utf8");
    console.log("[S4-Roles] CSV written to:", csvPath);

    // Step 5: Upload CSV — try learned strategies first, then coded, then AI
    // tryLearnedStrategies runs any previously auto-generated Playwright code first
    // The Browse button opens a native OS picker — we bypass it entirely.
    // SAP UI5 FileUploader hides the real input; we find it via JS evaluate.
    console.log("[S4-Roles] Uploading role CSV...");
    let uploaded = false;

    // Try auto-learned strategies first (generated from previous AI-resolved runs)
    if (!uploaded) {
      uploaded = await tryLearnedStrategies(page, "role_file_upload", { csvPath });
    }

    // Strategy 1: JS evaluate to find ANY input[type="file"] in the entire DOM
    // (including those hidden with display:none, visibility:hidden, opacity:0)
    try {
      const fileInputId = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="file"]');
        for (const input of inputs) {
          // Make it interactable
          input.style.display = "block";
          input.style.visibility = "visible";
          input.style.opacity = "1";
          input.style.width = "1px";
          input.style.height = "1px";
          input.removeAttribute("tabindex");
          return input.id || "__dealflow_file_input__";
        }
        return null;
      });

      if (fileInputId) {
        const input = fileInputId === "__dealflow_file_input__"
          ? page.locator('input[type="file"]').first()
          : page.locator(`#${fileInputId}`);
        await input.setInputFiles(csvPath, { timeout: 10000 });
        console.log("[S4-Roles] Uploaded via JS-exposed file input.");
        uploaded = true;
      }
    } catch (e) { console.warn("[S4-Roles] JS file input strategy failed:", e.message); }

    // Strategy 2: UI5 FileUploader hidden input (id ends in "-fu")
    if (!uploaded) {
      try {
        const fileInput = await getUI5FileInput(page);
        await fileInput.setInputFiles(csvPath, { timeout: 10000 });
        console.log("[S4-Roles] Uploaded via UI5 FileUploader.");
        uploaded = true;
      } catch (e) { console.warn("[S4-Roles] UI5 FileUploader strategy failed:", e.message); }
    }

    // Strategy 3: AI vision fallback — agent can see the dialog and act on it
    if (!uploaded) {
      console.warn("[S4-Roles] Coded strategies failed — engaging AI vision agent...");
      await withAIFallback(page, async () => { throw new Error("need AI"); },
        `The "Save User Role Assignments" dialog is open with a Browse button. The CSV file to upload is at: ${csvPath}. Find the hidden file input behind the Browse button and upload the file, or use any available method to attach the file.`,
        { credentials: creds, taskType: "role_file_upload", learnContext: { csvPath } }
      );
      // After AI attempts, try file input one more time
      try {
        const inputs = await page.$$('input[type="file"]');
        if (inputs.length > 0) {
          await inputs[0].setInputFiles(csvPath, { timeout: 10000 });
          uploaded = true;
          console.log("[S4-Roles] Uploaded after AI assistance.");
        }
      } catch {}
    }

    if (!uploaded) throw new Error("Could not find file input to upload role CSV — all strategies exhausted");

    await page.waitForTimeout(1500);
    await screenshot(page, "s4-roles-after-file-upload");

    // Step 6: Confirm upload — click Upload/OK in dialog footer
    console.log("[S4-Roles] Confirming upload...");
    await screenshot(page, "s4-roles-before-confirm");
    await withAIFallback(page, async () => {
      for (const label of ["Upload", "OK", "Save"]) {
        try {
          await clickUI5Button(page, label);
          console.log(`[S4-Roles] Clicked confirm button: "${label}"`);
          return;
        } catch {}
      }
      throw new Error("Could not find confirm button");
    }, "Click Upload or OK in the dialog footer to confirm the role assignment upload.", { credentials: creds });

    // Step 7: Wait for completion
    await page.waitForTimeout(5000);
    await waitForUI5Ready(page, 30000);
    await screenshot(page, "s4-roles-after-upload");

    // Step 8: Deterministic result check — no AI needed
    console.log("[S4-Roles] Checking upload result...");
    try {
      const hasError = await page.locator('[class*="Error"], [class*="error"], .sapMMsgStripError').first().isVisible({ timeout: 3000 }).catch(() => false);
      if (hasError) {
        const msg = await page.locator('[class*="Error"]').first().textContent().catch(() => "Unknown error");
        console.warn("[S4-Roles] Upload may have errors:", msg.trim().slice(0, 200));
      } else {
        console.log("[S4-Roles] Upload result looks good.");
      }
    } catch {}
    // Dismiss any open dialogs
    for (const btnText of ["Close", "OK"]) {
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
