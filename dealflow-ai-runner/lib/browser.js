// DealFlow AI Runner — Browser Manager
// Uses launchPersistentContext so the browser remembers cert selections,
// cookies, and SSO sessions between runs.

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import config from '../config.js';
import { aiResolve, withAIFallback } from './ai-agent.js';

let _context = null;
const USER_DATA_DIR = path.join(os.homedir(), ".projectflow-runner-profile");

export async function launchBrowser() {
  if (_context) return _context;
  console.log("[Browser] Launching persistent Chromium (headless:", config.browser.headless, ")...");
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

// ---------------------------------------------------------------------------
// SAP UI5 / Fiori Helpers
// ---------------------------------------------------------------------------

export async function waitForUI5Ready(page, timeoutMs = 20000) {
  try {
    await page.waitForFunction(() => {
      const core = window.sap?.ui?.getCore?.();
      if (!core) return false;
      const busy = document.querySelector('.sapUiLocalBusyIndicator, .sapMBusyIndicator, [aria-busy="true"]');
      if (busy && busy.offsetParent !== null) return false;
      return true;
    }, { timeout: timeoutMs });
  } catch {
    console.warn("[Browser] UI5 ready check timed out after", timeoutMs, "ms");
  }
}

export async function clickUI5Button(page, label) {
  const clicked = await page.evaluate((lbl) => {
    const core = window.sap?.ui?.getCore?.();
    if (!core) return false;
    const elements = core.mElements || {};
    for (const id in elements) {
      const el = elements[id];
      const meta = el.getMetadata?.()?.getName?.() || "";
      if (!meta.includes("Button") && !meta.includes("MenuItem") && !meta.includes("Link")) continue;
      const text = el.getText?.() || el.getTitle?.() || "";
      if (text.trim() === lbl || text.trim().includes(lbl)) {
        if (typeof el.firePress === "function") { el.firePress(); return true; }
        const dom = el.getDomRef?.();
        if (dom) { dom.click(); return true; }
      }
    }
    return false;
  }, label);

  if (clicked) {
    console.log(`[Browser] Clicked UI5 button: "${label}"`);
    return;
  }

  const btn = page.locator(`button:has-text("${label}"), [role="button"]:has-text("${label}")`).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click({ timeout: 10000 });
    console.log(`[Browser] Clicked button via DOM: "${label}"`);
    return;
  }

  throw new Error(`UI5 button "${label}" not found`);
}

export async function getUI5FileInput(page) {
  const inputId = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="file"]');
    for (const input of inputs) {
      input.style.display = "block";
      input.style.visibility = "visible";
      input.style.opacity = "1";
      input.style.width = "1px";
      input.style.height = "1px";
      input.removeAttribute("tabindex");
      return input.id || null;
    }
    return null;
  });
  if (inputId) return page.locator(`#${inputId}`);
  const fallback = page.locator('input[type="file"]').first();
  if (await fallback.count() > 0) return fallback;
  throw new Error("No file input found on page");
}

// ---------------------------------------------------------------------------
// Login & Navigation
// ---------------------------------------------------------------------------

export async function loginToSystem(page, url, username, password) {
  console.log("[Browser] Navigating to", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Broad "logged in" detection — works for Fiori, CBC, and other SAP apps
  const isLoggedIn = async () => {
    return await page.$('#shell-header, [data-sap-ui-area="shell"], .sapUshellShellHead, nav, [role="navigation"], [class*="shell"], [class*="Shell"], [class*="project"], [class*="workspace"], [class*="launchpad"], [class*="cbc"]');
  };

  if (await isLoggedIn()) {
    console.log("[Browser] Already logged in.");
    return true;
  }

  // Cert-only SSO: if no username, just wait for redirects
  if (!username) {
    console.log("[Browser] No credentials — waiting for cert SSO...");
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000);
      if (await isLoggedIn()) {
        console.log("[Browser] SSO login successful.");
        return true;
      }
    }
  }

  // Try standard email/password login if credentials provided
  if (username) {
    const emailField = await page.$('input[name="j_username"], input[name="email"], input[type="email"], #j_username');
    if (emailField) {
      console.log("[Browser] Found login form, entering email...");
      await emailField.fill(username);
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (submitBtn) await submitBtn.click();
      await page.waitForTimeout(2000);

      // After entering email, IAS may redirect to cert auth OR show password
      if (password) {
        const passField = await page.$('input[name="j_password"], input[name="password"], input[type="password"], #j_password');
        if (passField) {
          await passField.fill(password);
          const loginBtn = await page.$('button[type="submit"], input[type="submit"]');
          if (loginBtn) await loginBtn.click();
        }
      }
      // Wait for SSO redirect to complete
      await page.waitForTimeout(5000);
    }
  }

  if (await isLoggedIn()) {
    console.log("[Browser] Login successful.");
    return true;
  }

  // Hand off to AI agent for anything unexpected
  console.log("[Browser] Login didn't complete — engaging AI agent...");
  const credInfo = username
    ? `Credentials: username="${username}"${password ? ", password provided" : ", no password (cert SSO)"}.`
    : "This system uses certificate-based SSO — no username/password needed.";
  const resolved = await aiResolve(
    page,
    `I need to log into the SAP system at ${url}. Get past any dialogs (certificate selection, cookie consent, terms, redirects) and reach the application. ${credInfo} If you see the application loaded (a shell header, dashboard, navigation, or main content), respond "done".`,
    { maxAttempts: 10, credentials: { username, password } }
  );

  if (resolved || await isLoggedIn()) {
    console.log("[Browser] Login successful.");
    return true;
  }

  console.error("[Browser] Login failed after AI assistance.");
  return false;
}

export async function navigateToApp(page, baseUrl, appHash) {
  const url = baseUrl.replace(/\/$/, "") + "/ui#" + appHash;
  console.log("[Browser] Navigating to app:", appHash);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await waitForUI5Ready(page);
}

export async function waitForNotBusy(page, timeoutMs = 15000) {
  return waitForUI5Ready(page, timeoutMs);
}

export async function uploadFile(page, filePath) {
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.setInputFiles(filePath);
    console.log("[Browser] File uploaded:", filePath);
    return true;
  }
  console.error("[Browser] No file input found");
  return false;
}
