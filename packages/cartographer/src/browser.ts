import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import path from "node:path";
import os from "node:os";
import type { CartographerConfig } from "./config.js";
import type { CBCConnection } from "./btp-api.js";

const VIEWPORT = { width: 1024, height: 768 };

export async function launchBrowser(
  config: CartographerConfig,
): Promise<{ browser: Browser | null; context: BrowserContext; page: Page }> {
  if (config.cfRunner) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      ignoreHTTPSErrors: true,
    });
    context.setDefaultTimeout(30_000);
    const page = await context.newPage();
    return { browser, context, page };
  }

  const userDataDir = path.join(os.homedir(), ".cartographer-browser-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: config.headless,
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
  });
  context.setDefaultTimeout(30_000);
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser: null, context, page };
}

export async function closeBrowser(
  browser: Browser | null,
  context: BrowserContext,
): Promise<void> {
  await context.close();
  if (browser) await browser.close();
}

export async function loginToCBC(
  page: Page,
  connection: CBCConnection,
): Promise<void> {
  const { systemUrl, username, password } = connection;
  console.log(`[CBC] Navigating to ${systemUrl}`);
  await page.goto(systemUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const emailField = page.getByRole("textbox", { name: "Email or User Name" });
  if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("[CBC] Login form found");
    await emailField.click();
    await emailField.fill(username);
    await emailField.press("Tab");
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("textbox", { name: "Password" }).press("Enter");
    await page.waitForTimeout(3000);

    const cont = page.getByRole("button", { name: "Continue" });
    if (await cont.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cont.click();
      await page.waitForTimeout(3000);
    }
  } else {
    console.log("[CBC] Already authenticated");
  }
  await page.waitForTimeout(3000);

  const inAppOk = page.getByRole("button", { name: "OK" });
  if (await inAppOk.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inAppOk.click();
    await page.waitForTimeout(500);
    console.log("[CBC] Dismissed in-app help warning");
  }

  const closeLightbox = page.getByRole("button", { name: "Close Lightbox" });
  if (await closeLightbox.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeLightbox.click();
    await page.waitForTimeout(500);
  }

  const closeBtn = page.getByRole("button", { name: "Close" });
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  console.log("[CBC] Logged in");
}
