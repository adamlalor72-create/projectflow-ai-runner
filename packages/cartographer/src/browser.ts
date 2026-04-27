import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import path from "node:path";
import os from "node:os";
import type { CartographerConfig } from "./config.js";

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
