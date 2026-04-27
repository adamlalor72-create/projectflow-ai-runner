import type { Field } from "../../contracts/types/ui-map.js";
import type { Locator } from "../../contracts/types/page-adapter.js";

export async function fillField(
  locator: Locator,
  field: Field,
  value: unknown
): Promise<void> {
  switch (field.type) {
    case "text":
    case "textarea":
    case "number":
    case "custom":
      await locator.fill(String(value));
      break;

    case "date":
      await locator.fill("");
      await locator.fill(String(value));
      break;

    case "dropdown":
      if (field.enumeration) {
        const match = field.enumeration.find(
          (e) => e.value === String(value) || e.label === String(value)
        );
        if (match) {
          await locator.selectOption({ label: match.label });
        } else {
          await locator.selectOption(String(value));
        }
      } else {
        await locator.selectOption(String(value));
      }
      break;

    case "checkbox": {
      const checked = await locator.isChecked();
      const desired = Boolean(value);
      if (checked !== desired) {
        if (desired) {
          await locator.check();
        } else {
          await locator.uncheck();
        }
      }
      break;
    }

    case "radio":
      await locator.click();
      break;

    case "file":
      await locator.setInputFiles(
        Array.isArray(value) ? value.map(String) : String(value)
      );
      break;

    case "table_cell":
      await locator.click();
      await locator.fill(String(value));
      break;

    default:
      await locator.fill(String(value));
  }
}
