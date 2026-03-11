// DealFlow AI Runner — S/4 Worker Upload
// Navigates to Manage Workforce and uploads worker CSV
// AI vision is engaged proactively at every step for error recovery

import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import {
  newPage, loginToSystem, navigateToApp, waitForUI5Ready,
  clickUI5Button, fillUI5Input, getUI5FileInput, screenshot
} from '../lib/browser.js';
import { generateWorkerCSV } from '../lib/api.js';
import { aiResolve, withAIFallback, tryLearnedStrategies } from '../lib/ai-agent.js';

/**
 * After each step, check for unexpected error dialogs and recover via AI.
 */
async function verifyNoErrors(page, stepLabel, creds) {
  try {
    const errorPopup = await page.locator('.sapMMessageDialog, [role="alertdialog"], .sapMMsgBox').first().isVisible({ timeout: 1500 }).catch(() => false);
    if (errorPopup) {
      console.warn(`[S4-Worker] Unexpected error dialog after ${stepLabel} — engaging AI to recover...`);
      await screenshot(page, `s4-worker-error-at-${stepLabel}`);
      await aiResolve(page,
        `An unexpected error dialog or message box appeared on the S/4HANA screen after ${stepLabel}. Read the error, dismiss it, and get back to a usable state. Click OK, Close, or Cancel as appropriate.`,
        { maxAttempts: 3, credentials: creds }
      );
    }
  } catch {}
}

export async function runS4WorkerUpload({ job, step, users, connection }) {
  const page = await newPage();
  let csvPath = null;
  const connUser = connection.username || connection.user_name || "";
  const connPass = connection.password || "";
  const creds = { username: connUser, password: connPass };

  try {
    const baseUrl = connection.system_url.replace(/\/$/, "");

    // Step 1: Login
    console.log("[S4-Worker] Logging into S/4HANA...");
    const loggedIn = await loginToSystem(page, baseUrl, connUser, connPass);
    if (!loggedIn) throw new Error("Failed to login to S/4HANA");

    // Step 2: Navigate to Manage Workforce
    console.log("[S4-Worker] Navigating to Manage Workforce...");
    await navigateToApp(page, baseUrl, "WorkforcePerson-manage_v2");
    await screenshot(page, "s4-worker-manage-workforce");
    await verifyNoErrors(page, "navigate", creds);

    // Step 3: Click Import button
    console.log("[S4-Worker] Clicking Import button...");
    await withAIFallback(page, async () => {
      await clickUI5Button(page, "Import");
    }, "Click the 'Import' button in the top-right toolbar of Manage Workforce.", { credentials: creds });
    await page.waitForTimeout(1500);
    await screenshot(page, "s4-worker-after-import-click");
    await verifyNoErrors(page, "import-click", creds);

    // Step 4: Select import type — Worker (submenu item)
    console.log("[S4-Worker] Selecting import option: Worker...");
    await withAIFallback(page, async () => {
      // Strategy 1: Direct text click on menu item "Worker" (exact match)
      const items = await page.$$('[role="menuitem"], [role="option"], li, .sapMSLI, .sapMLIB');
      for (const item of items) {
        const text = (await item.textContent().catch(() => "")).trim();
        if (text === "Worker") {
          await item.click();
          console.log("[S4-Worker] Clicked 'Worker' menu item directly.");
          return;
        }
      }
      // Strategy 2: UI5 registry — match exact "Worker" text
      const clicked = await page.evaluate(() => {
        const core = sap?.ui?.getCore?.();
        if (!core) return false;
        for (const id in core.mElements || {}) {
          const el = core.mElements[id];
          const text = (el.getText?.() || el.getTitle?.() || "").trim();
          if (text === "Worker") {
            const dom = el.getDomRef?.();
            if (dom) { dom.click(); return true; }
            if (typeof el.firePress === "function") { el.firePress(); return true; }
          }
        }
        return false;
      });
      if (clicked) { console.log("[S4-Worker] Clicked 'Worker' via UI5 registry."); return; }
      throw new Error("Could not find Worker menu item");
    }, `A menu appeared with import options including "Worker and Work Agreement", "Worker and Work Agreement (Basic Import)", and "Worker". Click the plain "Worker" option — the last/simplest one in the list.`, { credentials: creds });
    await page.waitForTimeout(1500);
    await screenshot(page, "s4-worker-import-dialog");
    await verifyNoErrors(page, "import-type", creds);

    // Step 5: Generate CSV
    console.log(`[S4-Worker] Generating CSV for ${users.length} users...`);
    const csv = generateWorkerCSV(users, false);
    csvPath = path.join(process.cwd(), `_temp_workers_${job.id.slice(0, 8)}.csv`);
    await writeFile(csvPath, csv, "utf8");
    const csvLines = csv.split("\n");
    console.log(`[S4-Worker] CSV: ${csvLines.length} lines`);
    csvLines.slice(0, 4).forEach((l, i) => console.log(`[S4-Worker]   CSV[${i}]: ${l.trim().slice(0, 120)}`));

    // Step 6: Upload CSV file
    console.log("[S4-Worker] Uploading CSV file...");
    let uploaded = false;

    // Strategy 1: Expose hidden file inputs and use them
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
        console.log("[S4-Worker] Uploaded via exposed file input.");
        uploaded = true;
      }
    } catch (e) { console.warn("[S4-Worker] File input strategy failed:", e.message); }

    // Strategy 2: UI5 FileUploader
    if (!uploaded) {
      try {
        const fileInput = await getUI5FileInput(page);
        await fileInput.setInputFiles(csvPath);
        console.log("[S4-Worker] Uploaded via UI5 FileUploader.");
        uploaded = true;
      } catch (e) { console.warn("[S4-Worker] UI5 FileUploader failed:", e.message); }
    }

    // Strategy 3: AI vision
    if (!uploaded) {
      console.warn("[S4-Worker] Engaging AI for file upload...");
      await aiResolve(page,
        `The Worker import dialog is open. Upload the CSV file at: ${csvPath}. Find the file input or Browse button.`,
        { maxAttempts: 5, credentials: creds }
      );
      // Retry
      try {
        const inputs = await page.$$('input[type="file"]');
        if (inputs.length > 0) {
          await inputs[0].setInputFiles(csvPath, { timeout: 10000 });
          uploaded = true;
        }
      } catch {}
    }

    if (!uploaded) throw new Error("Could not upload worker CSV");
    await page.waitForTimeout(2000);
    await screenshot(page, "s4-worker-after-file-upload");
    await verifyNoErrors(page, "file-upload", creds);

    // Step 7: Fill Import Name (required field)
    const importName = `DealFlow_${new Date().toISOString().slice(0, 10)}_${users.length}u`;
    console.log("[S4-Worker] Filling import name:", importName);
    let nameSet = false;

    if (!nameSet) nameSet = await tryLearnedStrategies(page, "worker_import_name", { importName });
    // UI5 input by label
    if (!nameSet) {
      for (const label of ["Import Name", "Name", "Import"]) {
        try { await fillUI5Input(page, label, importName); nameSet = true; break; } catch {}
      }
    }
    // Direct input — first empty visible text input
    if (!nameSet) {
      try {
        const inputs = await page.$$('input[type="text"], input:not([type])');
        for (const input of inputs) {
          if (!(await input.isVisible().catch(() => false))) continue;
          if ((await input.inputValue().catch(() => "x")) === "") {
            await input.fill(importName);
            await input.dispatchEvent("input");
            await input.dispatchEvent("change");
            nameSet = true;
            break;
          }
        }
      } catch {}
    }
    // AI fallback
    if (!nameSet) {
      await aiResolve(page,
        `Fill the required "Import Name" field with: "${importName}". It may have a red border indicating it's required.`,
        { maxAttempts: 5, credentials: creds, taskType: "worker_import_name", learnContext: { importName } }
      );
    }
    await page.waitForTimeout(500);

    // Step 8: Confirm import — click Import in dialog footer
    console.log("[S4-Worker] Confirming import...");
    await screenshot(page, "s4-worker-before-confirm");
    await withAIFallback(page, async () => {
      // Try dialog-scoped buttons first
      const dialogBtns = await page.$$('[role="dialog"] button, .sapMDialog button');
      for (const btn of dialogBtns) {
        const text = await btn.textContent().catch(() => "");
        if (text.trim() === "Import") {
          await btn.click();
          console.log("[S4-Worker] Clicked dialog Import button.");
          return;
        }
      }
      await clickUI5Button(page, "Import");
    }, "Click the 'Import' button in the dialog footer to start the CSV import. NOT the toolbar Import button.", { credentials: creds });

    // Step 9: Wait for completion
    console.log("[S4-Worker] Waiting for import to complete...");
    await page.waitForTimeout(5000);
    await waitForUI5Ready(page, 30000);
    await screenshot(page, "s4-worker-after-import");

    // Step 10: Check result and dismiss dialog
    console.log("[S4-Worker] Checking import result...");
    try {
      const errorText = await page.locator('text=/Error|failed|invalid/i').first().isVisible({ timeout: 2000 }).catch(() => false);
      if (errorText) {
        const msg = await page.locator('text=/Error|failed/i').first().textContent().catch(() => "Unknown");
        console.warn("[S4-Worker] Import may have errors:", msg.trim().slice(0, 200));
      } else {
        console.log("[S4-Worker] Import result looks good.");
      }
    } catch {}
    for (const btnText of ["Close", "OK", "Cancel"]) {
      try { await clickUI5Button(page, btnText); await page.waitForTimeout(1000); break; } catch {}
    }

    console.log("[S4-Worker] Import completed.");
    return {
      users_uploaded: users.length,
      import_type: "worker",
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
