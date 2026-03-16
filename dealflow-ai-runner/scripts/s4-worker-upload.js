// ProjectFlow AI Runner — S/4 Worker Upload (Manage Workforce)
// Navigates to Manage Workforce and uploads worker CSV via UI5-aware helpers.
// Creates worker records (employees / contingent workers) in S/4HANA Cloud.
//
// Fiori app: Manage Workforce (WorkforcePerson-manage_v2)
// Import flow: Import button -> select import type -> upload CSV -> confirm

import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import {
  newPage, loginToSystem, navigateToApp, waitForUI5Ready,
  clickUI5Button, getUI5FileInput, screenshot
} from '../lib/browser.js';
import { generateWorkerCSV } from '../lib/api.js';
import { withAIFallback, tryLearnedStrategies } from '../lib/ai-agent.js';

export async function runS4WorkerUpload({ job, step, users, connection }) {
  const page = await newPage();
  let csvPath = null;
  const creds = { username: connection.username || connection.user_name, password: connection.password };

  try {
    if (users.length === 0) {
      console.log("[S4-Worker] No users to upload — skipping.");
      return { skipped: true, reason: "No users provided" };
    }

    const baseUrl = connection.system_url.replace(/\/$/, "");

    // Step 1: Login
    console.log("[S4-Worker] Logging into S/4HANA...");
    const loggedIn = await loginToSystem(page, baseUrl, connection.username || connection.user_name, connection.password);
    if (!loggedIn) throw new Error("Failed to login to S/4HANA");

    // Step 2: Navigate to Manage Workforce
    console.log("[S4-Worker] Navigating to Manage Workforce...");
    await navigateToApp(page, baseUrl, "WorkforcePerson-manage_v2");
    await screenshot(page, "s4-worker-manage-workforce");

    // Step 3: Click Import button in toolbar
    console.log("[S4-Worker] Step 3: Clicking Import button...");
    await withAIFallback(page, async () => {
      await clickUI5Button(page, "Import");
    }, "Click the 'Import' button in the toolbar of the Manage Workforce app.", { credentials: creds });
    await page.waitForTimeout(1500);
    await screenshot(page, "s4-worker-import-menu");

    // Step 4: Select import type from dropdown/menu
    const hasCC = users.some(u => u.company_code);
    const importOption = hasCC ? "Worker and Work Agreement" : "Worker";
    console.log(`[S4-Worker] Step 4: Selecting import type: "${importOption}"...`);

    let menuClicked = false;

    // Strategy 1: UI5 menu item by text
    try {
      menuClicked = await page.evaluate((opt) => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        const elements = core.mElements || {};
        for (const id in elements) {
          const el = elements[id];
          const text = el.getText?.() || el.getTitle?.() || "";
          if (text.includes(opt) || text.includes("Basic Import")) {
            if (typeof el.firePress === "function") el.firePress();
            else if (typeof el.fireItemPress === "function") el.fireItemPress();
            else { const dom = el.getDomRef?.(); if (dom) dom.click(); }
            return true;
          }
        }
        return false;
      }, importOption);
      if (menuClicked) console.log("[S4-Worker] Selected import type via UI5 registry.");
    } catch {}

    // Strategy 2: Text locator
    if (!menuClicked) {
      try {
        const item = page.locator(`text=/${importOption}|Basic Import/i`).first();
        if (await item.isVisible({ timeout: 3000 })) {
          await item.click({ timeout: 5000 });
          menuClicked = true;
          console.log("[S4-Worker] Selected import type via text locator.");
        }
      } catch {}
    }

    // Strategy 3: DOM scan for menu items / list items
    if (!menuClicked) {
      try {
        const items = await page.$$('[role="menuitem"], [role="listitem"], .sapMSLI, .sapMLIB, .sapMBtn');
        for (const item of items) {
          const text = await item.textContent().catch(() => "");
          if (text.includes(importOption) || text.includes("Worker") || text.includes("Basic Import")) {
            await item.click();
            menuClicked = true;
            console.log("[S4-Worker] Selected import type via DOM scan:", text.trim().slice(0, 60));
            break;
          }
        }
      } catch {}
    }

    // Strategy 4: AI fallback
    if (!menuClicked) {
      console.warn("[S4-Worker] Coded strategies failed for import type — engaging AI...");
      await withAIFallback(page, async () => { throw new Error("need AI"); },
        `A dropdown menu is showing after clicking Import. Select the "${importOption}" option. If you see "Worker and Work Agreement (Basic Import)" choose that.`,
        { credentials: creds, taskType: "worker_import_type" }
      );
    }

    await page.waitForTimeout(2000);
    await screenshot(page, "s4-worker-import-type-selected");

    // Step 5: Generate worker CSV
    console.log(`[S4-Worker] Step 5: Generating CSV for ${users.length} user(s)...`);
    const csv = generateWorkerCSV(users, hasCC);
    csvPath = path.join(process.cwd(), `_temp_workers_${job.id.slice(0, 8)}.csv`);
    await writeFile(csvPath, csv, "utf8");
    console.log("[S4-Worker] CSV written to:", csvPath);

    // Wait for import dialog/page
    let dialogOpened = await page.locator('[role="dialog"], .sapMDialog').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!dialogOpened) {
      console.log("[S4-Worker] No dialog detected — may be a full-page import view.");
    }
    await page.waitForTimeout(1500);
    await screenshot(page, "s4-worker-upload-dialog");

    // Step 6: Upload CSV
    console.log("[S4-Worker] Step 6: Uploading worker CSV...");
    let uploaded = false;

    if (!uploaded) uploaded = await tryLearnedStrategies(page, "worker_file_upload", { csvPath });

    // Strategy 1: JS evaluate to find file inputs
    if (!uploaded) {
      try {
        const fileInputId = await page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="file"]');
          for (const input of inputs) {
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
          console.log("[S4-Worker] Uploaded via JS-exposed file input.");
          uploaded = true;
        }
      } catch (e) { console.warn("[S4-Worker] JS file input strategy failed:", e.message); }
    }

    // Strategy 2: UI5 FileUploader
    if (!uploaded) {
      try {
        const fileInput = await getUI5FileInput(page);
        await fileInput.setInputFiles(csvPath, { timeout: 10000 });
        console.log("[S4-Worker] Uploaded via UI5 FileUploader.");
        uploaded = true;
      } catch (e) { console.warn("[S4-Worker] UI5 FileUploader strategy failed:", e.message); }
    }

    // Strategy 3: AI vision fallback
    if (!uploaded) {
      console.warn("[S4-Worker] Coded strategies failed — engaging AI...");
      await withAIFallback(page, async () => { throw new Error("need AI"); },
        `The import dialog is open with a Browse/Choose File button. Upload the CSV at: ${csvPath}.`,
        { credentials: creds, taskType: "worker_file_upload", learnContext: { csvPath } }
      );
      try {
        const inputs = await page.$$('input[type="file"]');
        if (inputs.length > 0) { await inputs[0].setInputFiles(csvPath, { timeout: 10000 }); uploaded = true; }
      } catch {}
    }

    if (!uploaded) throw new Error("Could not upload worker CSV — all strategies exhausted");

    await page.waitForTimeout(1500);
    await screenshot(page, "s4-worker-after-file-upload");

    // Step 7: Set import name if field exists
    try {
      const nameInput = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return null;
        const elements = core.mElements || {};
        for (const id in elements) {
          const el = elements[id];
          const meta = el.getMetadata?.()?.getName?.() || "";
          if (meta === "sap.m.Input") {
            const ph = el.getPlaceholder?.() || "";
            if (ph.includes("Import") || ph.includes("Name")) return id;
          }
        }
        return null;
      });
      if (nameInput) {
        const importName = `ProjectFlow_${new Date().toISOString().slice(0, 10)}_${users.length}users`;
        await page.evaluate((id, val) => {
          const el = sap.ui.getCore().byId(id);
          if (el?.setValue) { el.setValue(val); el.fireChange?.({ value: val }); }
        }, nameInput, importName);
        console.log("[S4-Worker] Set import name:", importName);
      }
    } catch (e) { console.warn("[S4-Worker] Import name field not found (optional):", e.message); }

    // Step 8: Confirm import
    console.log("[S4-Worker] Step 8: Confirming import...");
    await screenshot(page, "s4-worker-before-confirm");
    await withAIFallback(page, async () => {
      for (const label of ["Import", "Upload", "OK", "Save"]) {
        try { await clickUI5Button(page, label); console.log(`[S4-Worker] Clicked: "${label}"`); return; } catch {}
      }
      throw new Error("Could not find confirm button");
    }, "Click Import or OK in the dialog footer to start the CSV import.", { credentials: creds });

    // Step 9: Wait for completion
    console.log("[S4-Worker] Step 9: Waiting for import...");
    await page.waitForTimeout(5000);
    await waitForUI5Ready(page, 30000);
    await screenshot(page, "s4-worker-after-import");

    // Step 10: Check result
    console.log("[S4-Worker] Checking result...");
    let hasError = false;
    try {
      hasError = await page.locator('[class*="Error"], .sapMMsgStripError').first().isVisible({ timeout: 3000 }).catch(() => false);
      if (hasError) {
        const msg = await page.locator('[class*="Error"]').first().textContent().catch(() => "Unknown error");
        console.warn("[S4-Worker] Import errors:", msg.trim().slice(0, 200));
      } else {
        console.log("[S4-Worker] Import looks good.");
      }
    } catch {}

    let successMsg = "";
    try {
      const strip = await page.locator('.sapMMsgStripSuccess, .sapMMsgStripInformation').first();
      if (await strip.isVisible({ timeout: 2000 }).catch(() => false)) {
        successMsg = await strip.textContent().catch(() => "");
      }
    } catch {}

    for (const btn of ["Close", "OK", "Done"]) {
      try { await clickUI5Button(page, btn); await page.waitForTimeout(1000); break; } catch {}
    }

    console.log(`[S4-Worker] Completed. ${users.length} worker(s) uploaded.`);
    return {
      users_uploaded: users.length,
      import_type: hasCC ? "worker_and_work_agreement" : "worker_data",
      has_errors: hasError,
      success_message: successMsg.trim().slice(0, 200) || null,
      timestamp: new Date().toISOString(),
    };

  } catch (err) {
    await screenshot(page, "s4-worker-error");
    throw err;
  } finally {
    if (csvPath) await unlink(csvPath).catch(() => {});
    await page.close().catch(() => {});
  }
}
