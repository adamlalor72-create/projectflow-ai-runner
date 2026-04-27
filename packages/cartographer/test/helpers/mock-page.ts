import type { PageAdapter, Locator } from "../../contracts/types/page-adapter.js";

export interface MockLocatorOptions {
  visible?: boolean;
  checked?: boolean;
  textContent?: string | null;
  throwOnFill?: boolean;
  throwOnClick?: boolean;
  throwOnWaitFor?: boolean;
}

export function createMockLocator(options: MockLocatorOptions = {}): Locator & { calls: string[] } {
  const calls: string[] = [];
  let checked = options.checked ?? false;

  return {
    calls,
    async fill(value: string) {
      if (options.throwOnFill) throw new Error("fill failed");
      calls.push(`fill:${value}`);
    },
    async click() {
      if (options.throwOnClick) throw new Error("click failed");
      calls.push("click");
    },
    async check() {
      checked = true;
      calls.push("check");
    },
    async uncheck() {
      checked = false;
      calls.push("uncheck");
    },
    async isChecked() {
      return checked;
    },
    async isVisible() {
      return options.visible ?? true;
    },
    async setInputFiles(files: string | string[]) {
      calls.push(`setInputFiles:${Array.isArray(files) ? files.join(",") : files}`);
    },
    async selectOption(value: string | { label: string }) {
      const v = typeof value === "string" ? value : value.label;
      calls.push(`selectOption:${v}`);
      return [v];
    },
    async textContent() {
      return options.textContent ?? null;
    },
    async waitFor() {
      if (options.throwOnWaitFor) throw new Error("waitFor timeout");
    },
  };
}

export function createMockPage(
  locators: Record<string, Locator> = {}
): PageAdapter & { calls: string[]; gotoHistory: string[] } {
  const calls: string[] = [];
  const gotoHistory: string[] = [];

  const defaultLocator = createMockLocator();

  return {
    calls,
    gotoHistory,
    async goto(url: string) {
      gotoHistory.push(url);
      calls.push(`goto:${url}`);
    },
    locator(selector: string) {
      calls.push(`locator:${selector}`);
      return locators[selector] ?? defaultLocator;
    },
    getByLabel(label: string) {
      calls.push(`getByLabel:${label}`);
      return locators[`aria:${label}`] ?? defaultLocator;
    },
    getByText(text: string) {
      calls.push(`getByText:${text}`);
      return locators[`text:${text}`] ?? defaultLocator;
    },
    mouse: {
      async click(x: number, y: number) {
        calls.push(`mouse.click:${x},${y}`);
      },
    },
    async screenshot() {
      calls.push("screenshot");
      return Buffer.from("fake-screenshot");
    },
    async waitForTimeout(ms: number) {
      calls.push(`waitForTimeout:${ms}`);
    },
  };
}
