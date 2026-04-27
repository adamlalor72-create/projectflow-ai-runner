import type { LoadEngineAPI, LoadResult } from "../../contracts/load-engine-api.js";
import type { UIMap } from "../../contracts/types/ui-map.js";
import type { PageAdapter } from "../../contracts/types/page-adapter.js";
import { resolveSelector } from "./selector-resolver.js";
import { fillField } from "./field-filler.js";

export class LoadEngine implements LoadEngineAPI {
  private page: PageAdapter;

  constructor(page: PageAdapter) {
    this.page = page;
  }

  async load(
    map: UIMap,
    data: Record<string, unknown>,
    options?: { dry_run?: boolean; screenshot_on_error?: boolean }
  ): Promise<LoadResult> {
    const start = Date.now();
    let fieldsSet = 0;
    let fieldsSkipped = 0;
    const errors: LoadResult["errors"] = [];
    const screenshots: string[] = [];

    if (map.navigation.deep_link) {
      await this.page.goto(map.navigation.deep_link);
    }

    for (const field of map.fields) {
      const value = data[field.id];
      if (value === undefined) {
        fieldsSkipped++;
        continue;
      }

      if (options?.dry_run) {
        fieldsSet++;
        continue;
      }

      try {
        const resolved = await resolveSelector(this.page, field.selectors);
        await fillField(resolved.locator, field, value);
        fieldsSet++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({
          field_id: field.id,
          error: msg,
          selector_used: field.selectors.primary,
        });

        if (options?.screenshot_on_error) {
          try {
            const buf = await this.page.screenshot();
            screenshots.push(buf.toString("base64").slice(0, 100) + "...");
          } catch {
            // ignore screenshot failure
          }
        }
      }
    }

    return {
      success: errors.length === 0,
      fields_set: fieldsSet,
      fields_skipped: fieldsSkipped,
      errors,
      screenshots,
      duration_ms: Date.now() - start,
    };
  }

  async bulkLoad(
    items: Array<{ map: UIMap; data: Record<string, unknown> }>,
    options?: { stop_on_error?: boolean; dry_run?: boolean }
  ): Promise<LoadResult[]> {
    const results: LoadResult[] = [];

    for (const item of items) {
      const result = await this.load(item.map, item.data, {
        dry_run: options?.dry_run,
        screenshot_on_error: true,
      });
      results.push(result);

      if (options?.stop_on_error && !result.success) {
        break;
      }
    }

    return results;
  }
}
