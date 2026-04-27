export interface Locator {
  fill(value: string): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
  check(): Promise<void>;
  uncheck(): Promise<void>;
  isChecked(): Promise<boolean>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  setInputFiles(files: string | string[]): Promise<void>;
  selectOption(value: string | { label: string }): Promise<string[]>;
  textContent(): Promise<string | null>;
  waitFor(options?: { state?: "visible" | "attached"; timeout?: number }): Promise<void>;
}

export interface PageAdapter {
  goto(url: string): Promise<void>;
  locator(selector: string): Locator;
  getByLabel(label: string): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  mouse: { click(x: number, y: number): Promise<void> };
  screenshot(options?: { path?: string }): Promise<Buffer>;
  waitForTimeout(ms: number): Promise<void>;
}
