import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

export interface CartographerConfig {
  anthropicApiKey: string;
  dbPath: string;
  knowledgeRoot: string;
  cbcBaseUrl: string;
  headless: boolean;
  cfRunner: boolean;
}

export function loadConfig(): CartographerConfig {
  const cfRunner =
    process.env.CF_RUNNER === "true" || !!process.env.VCAP_APPLICATION;

  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    dbPath:
      process.env.CARTOGRAPHER_DB_PATH ??
      path.join(PKG_ROOT, "data", "cartographer.db"),
    knowledgeRoot: path.join(PKG_ROOT, "knowledge"),
    cbcBaseUrl: process.env.CBC_BASE_URL ?? "",
    headless: cfRunner ? true : process.env.HEADLESS !== "false",
    cfRunner,
  };
}
