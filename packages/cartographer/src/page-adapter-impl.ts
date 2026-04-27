import type { Page } from "playwright";
import type { PageAdapter, Locator } from "../contracts/types/page-adapter.js";

function wrapLocator(loc: import("playwright").Locator): Locator {
  return {
    fill: (v) => loc.fill(v),
    click: (o) => loc.click(o),
    check: () => loc.check(),
    uncheck: () => loc.uncheck(),
    isChecked: () => loc.isChecked(),
    isVisible: (o) => loc.isVisible(o),
    setInputFiles: (f) => loc.setInputFiles(f),
    selectOption: (v) => loc.selectOption(v as string),
    textContent: () => loc.textContent(),
    waitFor: (o) => loc.waitFor(o),
  };
}

export function wrapPage(page: Page): PageAdapter {
  return {
    goto: (url) => page.goto(url).then(() => undefined),
    locator: (sel) => wrapLocator(page.locator(sel)),
    getByLabel: (label) => wrapLocator(page.getByLabel(label)),
    getByText: (text, opts) => wrapLocator(page.getByText(text, opts)),
    mouse: {
      click: (x, y) => page.mouse.click(x, y),
    },
    screenshot: (opts) => page.screenshot(opts),
    waitForTimeout: (ms) => page.waitForTimeout(ms),
  };
}
