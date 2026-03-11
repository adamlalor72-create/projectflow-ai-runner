// DealFlow AI Runner — Browser Manager
// Manages Playwright browser lifecycle with AI Vision Agent fallback
// When anything unexpected happens, the AI agent takes over

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import config from '../config.js';
import { aiResolve, withAIFallback } from './ai-agent.js';

let _browser = null;

export async function launchBrowser() {
  if (_browser) return _browser;
  console.log("[Browser] Launching Chromium (headless:", config.browser.headless, ")...");

  const args = [];
  const certSubject = config.browser.clientCertSubject;
  if (certSubject) {
    // Auto-select the SAP SSO client certificate without prompting.
    // This is a local dev workaround — on BTP the runner uses username/password
    // from SystemConnections and the cert dialog never appears.
    args.push(`--auto-select-certificate-for-urls={"pattern":"*","filter":{"SUBJECT":{"CN":"${certSubject}"}}}`);
    console.log("[Browser] Auto-selecting client cert subject:", certSubject);
  }

  _browser = await chromium.launch({
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
    args,
  });
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    console.log("[Browser] Closed.");
  }
}

export async function newPage() {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  context.setDefaultTimeout(config.browser.timeout);
  return context.newPage();
}

// Take a screenshot and save to screenshots dir
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
 * Login to an SAP system with AI fallback.
 * First attempts standard login, then hands off to AI for anything unexpected
 * (certificate dialogs, cookie banners, MFA prompts, etc.)
 */
export async function loginToSystem(page, url, username, password) {
  console.log("[Browser] Navigating to", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Let AI handle the full login flow — it can deal with certs, cookies, forms, etc.
  const isLoggedIn = () => page.$('#shell-header, [data-sap-ui-area="shell"], .sapUshellShellHead');

  // Check if already logged in
  if (await isLoggedIn()) {
    console.log("[Browser] Already logged in.");
    return true;
  }

  // Try standard login first
  const emailField = await page.$('input[name="j_username"], input[name="email"], input[type="email"], #j_username');
  if (emailField) {
    console.log("[Browser] Found login form, entering credentials...");
    await emailField.fill(username);
    const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(1500);

    const passField = await page.$('input[name="j_password"], input[name="password"], input[type="password"], #j_password');
    if (passField) {
      await passField.fill(password);
      const loginBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (loginBtn) await loginBtn.click();
    }
    await page.waitForTimeout(3000);
  }

  // Check if we're in
  if (await isLoggedIn()) {
    console.log("[Browser] Login successful.");
    return true;
  }

  // Something unexpected — hand off to AI agent
  console.log("[Browser] Login didn't complete as expected — engaging AI agent...");
  const resolved = await aiResolve(
    page,
    `I need to log into the SAP system at ${url}. I need to get past any dialogs (certificate selection, cookie consent, terms acceptance, etc.) and reach the Fiori launchpad shell. The login credentials are username="${username}" and the password is provided. If you see a certificate selection dialog, pick the user certificate (not the machine certificate). If you see a Fiori shell header, the login is complete — respond with "done".`,
    { maxAttempts: 8, credentials: { username, password } }
  );

  if (resolved) {
    console.log("[Browser] AI agent completed login.");
    return true;
  }

  // Final check
  if (await isLoggedIn()) {
    console.log("[Browser] Login successful (post-AI).");
    return true;
  }

  console.error("[Browser] Login failed after AI assistance.");
  return false;
}

// Navigate to a specific Fiori app by hash
export async function navigateToApp(page, baseUrl, appHash) {
  const url = baseUrl.replace(/\/$/, "") + "/ui#" + appHash;
  console.log("[Browser] Navigating to app:", appHash);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await waitForNotBusy(page);
}

// Wait for a Fiori busy indicator to disappear
export async function waitForNotBusy(page, timeoutMs = 15000) {
  try {
    await page.waitForFunction(() => {
      const busy = document.querySelector('.sapUiLocalBusyIndicator, .sapMBusyIndicator, [aria-busy="true"]');
      return !busy || busy.offsetParent === null;
    }, { timeout: timeoutMs });
  } catch {
    console.warn("[Browser] Busy indicator still showing after timeout");
  }
}

// Upload a file to a file input dialog
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
