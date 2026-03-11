// DealFlow AI Runner — Browser Manager
// Manages Playwright browser lifecycle with AI Vision Agent fallback
// When anything unexpected happens, the AI agent takes over

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import config from '../config.js';
import { aiResolve, withAIFallback } from './ai-agent.js';

// Persistent context survives across newPage() calls within a job.
// Chromium remembers the cert selection in the user data dir, so the
// dialog only appears on the very first run — never again after that.
let _context = null;
const USER_DATA_DIR = path.join(os.homedir(), ".dealflow-runner-profile");

export async function launchBrowser() {
  if (_context) return _context;
  console.log("[Browser] Launching Chromium persistent context (headless:", config.browser.headless, ")...");
  console.log("[Browser] Profile dir:", USER_DATA_DIR);
  _context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  _context.setDefaultTimeout(config.browser.timeout);
  return _context;
}

export async function closeBrowser() {
  if (_context) {
    await _context.close();
    _context = null;
    console.log("[Browser] Closed.");
  }
}

export async function newPage() {
  const context = await launchBrowser();
  return context.newPage();
}

// ---------------------------------------------------------------------------
// SAP UI5 / Fiori Helpers
// ---------------------------------------------------------------------------
// UI5 renders its controls in a virtual control tree. Standard CSS selectors
// are unreliable because button text lives in nested <bdi>/<span> tags and
// inputs have synthetic wrappers. These helpers query the UI5 control registry
// directly via JavaScript, which is the most reliable approach for Fiori apps.

/**
 * Wait for SAP UI5 framework to be fully initialised and idle.
 * Replaces the CSS-only waitForNotBusy — checks both the UI5 core ready state
 * and the busy indicator DOM.
 */
export async function waitForUI5Ready(page, timeoutMs = 20000) {
  try {
    await page.waitForFunction(() => {
      if (typeof sap === "undefined" || !sap?.ui?.getCore) return false;
      const core = sap.ui.getCore();
      if (!core.isInitialized()) return false;
      const busy = document.querySelector(
        '.sapUiLocalBusyIndicator, .sapMBusyIndicator, [aria-busy="true"]'
      );
      return !busy || busy.offsetParent === null;
    }, { timeout: timeoutMs });
    console.log("[Browser] UI5 ready.");
  } catch {
    console.warn("[Browser] UI5 ready timeout — continuing anyway.");
  }
}

// Alias for backward compat
export async function waitForNotBusy(page, timeoutMs = 15000) {
  return waitForUI5Ready(page, timeoutMs);
}

/**
 * Click a SAP UI5 Button by its exact text label.
 * Strategy 1: Fire UI5 press event via control registry (most reliable).
 * Strategy 2: Playwright getByRole.
 * Strategy 3: Broad text locator (last resort).
 */
export async function clickUI5Button(page, text, options = {}) {
  const timeout = options.timeout || 10000;

  // Strategy 1: UI5 control registry
  const fired = await page.evaluate((btnText) => {
    try {
      if (typeof sap === "undefined") return false;
      const elements = sap.ui.getCore().mElements || {};
      for (const id in elements) {
        const el = elements[id];
        const meta = el.getMetadata?.()?.getName?.();
        if (
          (meta === "sap.m.Button" || meta === "sap.m.OverflowToolbarButton") &&
          el.getText?.() === btnText &&
          el.getVisible?.()
        ) {
          el.firePress();
          return true;
        }
      }
    } catch {}
    return false;
  }, text);

  if (fired) {
    console.log("[Browser] Clicked UI5 Button (control registry):", text);
    return true;
  }

  // Strategy 2: getByRole
  try {
    const btn = page.getByRole("button", { name: text, exact: true });
    await btn.click({ timeout });
    console.log("[Browser] Clicked UI5 Button (getByRole):", text);
    return true;
  } catch {}

  // Strategy 3: Text locator
  try {
    const el = page.locator(`text="${text}"`).first();
    if (await el.isVisible({ timeout: 3000 })) {
      await el.click({ timeout });
      console.log("[Browser] Clicked UI5 Button (text locator):", text);
      return true;
    }
  } catch {}

  throw new Error(`UI5 button not found: "${text}"`);
}

/**
 * Fill a SAP UI5 Input field identified by its label text or placeholder.
 * Strategy 1: UI5 control registry.
 * Strategy 2: Playwright getByLabel.
 * Strategy 3: Placeholder match.
 */
export async function fillUI5Input(page, labelText, value) {
  // Strategy 1: UI5 control registry
  const filled = await page.evaluate(({ label, val }) => {
    try {
      if (typeof sap === "undefined") return false;
      const elements = sap.ui.getCore().mElements || {};
      for (const id in elements) {
        const el = elements[id];
        const meta = el.getMetadata?.()?.getName?.();
        if (meta === "sap.m.Input" || meta === "sap.m.SearchField") {
          const labelEl = sap.ui.getCore().byId(el.getAriaLabelledBy?.()[0]);
          if (labelEl?.getText?.() === label || el.getPlaceholder?.() === label) {
            el.setValue(val);
            el.fireChange({ value: val });
            return true;
          }
        }
      }
    } catch {}
    return false;
  }, { label: labelText, val: value });

  if (filled) {
    console.log("[Browser] Filled UI5 Input (control registry):", labelText);
    return true;
  }

  // Strategy 2: getByLabel
  try {
    const input = page.getByLabel(labelText);
    if (await input.isVisible({ timeout: 2000 })) {
      await input.fill(value);
      console.log("[Browser] Filled UI5 Input (getByLabel):", labelText);
      return true;
    }
  } catch {}

  // Strategy 3: Placeholder
  try {
    const input = page.locator(`input[placeholder*="${labelText}"]`).first();
    if (await input.isVisible({ timeout: 2000 })) {
      await input.fill(value);
      console.log("[Browser] Filled UI5 Input (placeholder):", labelText);
      return true;
    }
  } catch {}

  throw new Error(`UI5 input not found: "${labelText}"`);
}

/**
 * Get the real <input type="file"> behind a SAP UI5 FileUploader control.
 * UI5 wraps file inputs in a custom control — the actual input is hidden
 * but Playwright's setInputFiles works on hidden inputs.
 */
export async function getUI5FileInput(page) {
  // Strategy 1: UI5 FileUploader control registry — inner input has id = controlId + "-fu"
  const inputId = await page.evaluate(() => {
    try {
      if (typeof sap === "undefined") return null;
      const elements = sap.ui.getCore().mElements || {};
      for (const id in elements) {
        const el = elements[id];
        const meta = el.getMetadata?.()?.getName?.();
        if (meta === "sap.ui.unified.FileUploader" || meta === "sap.m.upload.UploadSet") {
          return id + "-fu";
        }
      }
    } catch {}
    return null;
  });

  if (inputId) {
    const input = page.locator(`#${inputId}`);
    if (await input.count() > 0) {
      console.log("[Browser] Found UI5 FileUploader input:", inputId);
      return input;
    }
  }

  // Strategy 2: Any file input (visible or hidden)
  const inputs = page.locator('input[type="file"]');
  if (await inputs.count() > 0) {
    console.log("[Browser] Found file input (generic).");
    return inputs.first();
  }

  throw new Error("No file input found on page");
}

// ---------------------------------------------------------------------------
// Core navigation + auth
// ---------------------------------------------------------------------------

export async function screenshot(page, name) {
  try {
    await mkdir(config.browser.screenshotDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = path.join(config.browser.screenshotDir, `${name}_${ts}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log("[Browser] Screenshot saved:", filepath);
    return filepath;
  } catch (e) {
    console.error("[Browser] Screenshot failed:", e.message);
    return null;
  }
}

/**
 * Login to an SAP system.
 * Handles both single-page and two-step login forms, with AI fallback.
 */
export async function loginToSystem(page, url, username, password) {
  console.log("[Browser] Navigating to", url);

  // Navigate — S4 often redirects to IAS, which can destroy the context
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (err) {
    // Navigation may fail due to redirect — wait and continue
    if (err.message.includes("Execution context") || err.message.includes("navigating")) {
      console.log("[Browser] Navigation redirect detected, waiting for page to settle...");
      await page.waitForTimeout(3000);
    } else {
      throw err;
    }
  }
  await page.waitForTimeout(3000);

  const isLoggedIn = async () => {
    try {
      return !!(await page.$('#shell-header, [data-sap-ui-area="shell"], .sapUshellShellHead'));
    } catch {
      // Context may still be settling after redirect
      return false;
    }
  };

  if (await isLoggedIn()) {
    console.log("[Browser] Already logged in.");
    return true;
  }

  // Wait for login form — may take a moment after IAS redirect
  let emailField = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      emailField = await page.$(
        'input[name="j_username"], input[name="email"], input[type="email"], #j_username'
      );
      if (emailField) break;
    } catch {
      // Context destroyed — page still redirecting
    }
    await page.waitForTimeout(1500);
  }

  if (emailField) {
    console.log("[Browser] Found login form, entering credentials...");
    await emailField.fill(username);

    const passFieldImmediate = await page.$(
      'input[name="j_password"], input[name="password"], input[type="password"], #j_password'
    );
    if (passFieldImmediate) {
      await passFieldImmediate.fill(password);
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (submitBtn) await submitBtn.click();
      await page.waitForTimeout(3000);
    } else {
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (submitBtn) await submitBtn.click();
      await page.waitForTimeout(1500);
      const passField = await page.$(
        'input[name="j_password"], input[name="password"], input[type="password"], #j_password'
      );
      if (passField) {
        await passField.fill(password);
        const loginBtn = await page.$('button[type="submit"], input[type="submit"]');
        if (loginBtn) await loginBtn.click();
      }
      await page.waitForTimeout(3000);
    }
  }

  if (await isLoggedIn()) {
    console.log("[Browser] Login successful.");
    return true;
  }

  console.log("[Browser] Login didn't complete — engaging AI agent...");
  const resolved = await aiResolve(
    page,
    `Log into SAP at ${url}. Get past any dialogs and reach the Fiori launchpad shell. Username="${username}". Respond "done" when the Fiori shell header is visible.`,
    { maxAttempts: 8, credentials: { username, password } }
  );

  if (resolved || await isLoggedIn()) {
    console.log("[Browser] Login successful.");
    return true;
  }

  console.error("[Browser] Login failed.");
  return false;
}

/**
 * Navigate to a Fiori app by hash and wait for UI5 to be ready.
 */
export async function navigateToApp(page, baseUrl, appHash) {
  const url = baseUrl.replace(/\/$/, "") + "/ui#" + appHash;
  console.log("[Browser] Navigating to app:", appHash);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await waitForUI5Ready(page);
}
