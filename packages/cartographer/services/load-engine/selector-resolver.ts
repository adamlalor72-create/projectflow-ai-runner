import type { Selectors } from "../../contracts/types/ui-map.js";
import type { PageAdapter, Locator } from "../../contracts/types/page-adapter.js";

export interface ResolvedSelector {
  locator: Locator;
  strategy: "primary" | "aria" | "text" | "coords";
}

export async function resolveSelector(
  page: PageAdapter,
  selectors: Selectors,
  timeout = 3000
): Promise<ResolvedSelector> {
  if (selectors.primary) {
    try {
      const loc = page.locator(selectors.primary);
      await loc.waitFor({ state: "visible", timeout });
      return { locator: loc, strategy: "primary" };
    } catch {
      // fall through
    }
  }

  if (selectors.fallback_aria) {
    try {
      const loc = page.getByLabel(selectors.fallback_aria);
      await loc.waitFor({ state: "visible", timeout });
      return { locator: loc, strategy: "aria" };
    } catch {
      // fall through
    }
  }

  if (selectors.fallback_text) {
    try {
      const loc = page.getByText(selectors.fallback_text, { exact: true });
      await loc.waitFor({ state: "visible", timeout });
      return { locator: loc, strategy: "text" };
    } catch {
      // fall through
    }
  }

  if (selectors.fallback_coords) {
    return {
      locator: {
        async fill() {
          await page.mouse.click(selectors.fallback_coords!.x, selectors.fallback_coords!.y);
        },
        async click() {
          await page.mouse.click(selectors.fallback_coords!.x, selectors.fallback_coords!.y);
        },
        async check() {
          await page.mouse.click(selectors.fallback_coords!.x, selectors.fallback_coords!.y);
        },
        async uncheck() {
          await page.mouse.click(selectors.fallback_coords!.x, selectors.fallback_coords!.y);
        },
        async isChecked() { return false; },
        async isVisible() { return true; },
        async setInputFiles() { throw new Error("Cannot set files via coords"); },
        async selectOption() { throw new Error("Cannot select option via coords"); return []; },
        async textContent() { return null; },
        async waitFor() {},
      },
      strategy: "coords",
    };
  }

  throw new Error(
    `All selectors failed for: ${JSON.stringify(selectors)}`
  );
}
