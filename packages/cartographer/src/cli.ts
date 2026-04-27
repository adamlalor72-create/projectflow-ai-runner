#!/usr/bin/env node
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { resolveConfig, type CBCConnection } from "./btp-api.js";
import { createServices, type ServiceContainer } from "./create-services.js";
import { launchBrowser, closeBrowser, loginToCBC } from "./browser.js";
import { wrapPage } from "./page-adapter-impl.js";

const USAGE = `Usage: cartographer <command> [args]

Commands:
  research <activity_id> [name]   Research an activity (seeds knowledge)
  discover <activity_id> [name]   Discover UI map for an activity
  verify   <activity_id>          Verify a UI map with synthetic data
  load     <activity_id> <json>   Load data from JSON file into an activity
  drift    <activity_id>          Check an activity for UI drift
  drift-all                       Check all verified activities for drift
  list                            List all mapped activities
  describe <activity_id>          Show full details for an activity

Environment:
  DEALFLOW_RUNNER_KEY   BTP API key (resolves Anthropic key + CBC connection)
  ANTHROPIC_API_KEY     Override Anthropic key directly
  CBC_BASE_URL          Override CBC system URL directly
  HEADLESS              Set to "false" for visible browser (default: true)`;

async function withBrowser(
  fn: (services: ServiceContainer) => Promise<void>,
): Promise<void> {
  const rawConfig = loadConfig();
  const { config, connection } = await resolveConfig(rawConfig);

  mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const { browser, context, page } = await launchBrowser(config);

  if (connection) {
    await loginToCBC(page, connection);
  }

  const pageAdapter = wrapPage(page);
  const services = createServices(config, pageAdapter);

  try {
    await fn(services);
  } finally {
    services.close();
    await closeBrowser(browser, context);
  }
}

async function withoutBrowser(
  fn: (services: ServiceContainer) => Promise<void>,
): Promise<void> {
  const rawConfig = loadConfig();
  const { config } = await resolveConfig(rawConfig);

  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const services = createServices(config);

  try {
    await fn(services);
  } finally {
    services.close();
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case "research": {
      const [activityId, activityName] = args;
      if (!activityId) {
        console.error("Usage: cartographer research <activity_id> [name]");
        process.exit(1);
      }
      await withoutBrowser(async (svc) => {
        console.log(`Researching activity ${activityId}...`);
        const result = await svc.mcp.researchActivity({
          activity_id: activityId,
          activity_name: activityName,
        });
        console.log(
          `Done. ${result.files_written.length} files written, confidence: ${result.overall_confidence}`,
        );
        console.log(`Cost: $${result.cost_usd.toFixed(4)}`);
      });
      break;
    }

    case "discover": {
      const [activityId, activityName] = args;
      if (!activityId) {
        console.error("Usage: cartographer discover <activity_id> [name]");
        process.exit(1);
      }
      await withBrowser(async (svc) => {
        console.log(`Discovering activity ${activityId}...`);
        const result = await svc.mcp.discoverActivity({
          activity_id: activityId,
          activity_name: activityName,
        });
        console.log(
          `Done. ${result.fields_found} fields found, new: ${result.is_new}`,
        );
        console.log(`Cost: $${result.cost_usd.toFixed(4)}`);
      });
      break;
    }

    case "verify": {
      const [activityId] = args;
      if (!activityId) {
        console.error("Usage: cartographer verify <activity_id>");
        process.exit(1);
      }
      await withBrowser(async (svc) => {
        console.log(`Verifying activity ${activityId}...`);
        const result = await svc.mcp.verifyActivity({
          activity_id: activityId,
        });
        console.log(
          `${result.passed ? "PASSED" : "FAILED"} — ${result.iterations} iterations, ${result.failures.length} failures`,
        );
        console.log(`Cost: $${result.cost_usd.toFixed(4)}`);
      });
      break;
    }

    case "load": {
      const [activityId, jsonPath] = args;
      if (!activityId || !jsonPath) {
        console.error("Usage: cartographer load <activity_id> <json-file>");
        process.exit(1);
      }
      await withBrowser(async (svc) => {
        const data = JSON.parse(
          readFileSync(path.resolve(jsonPath), "utf-8"),
        ) as Record<string, unknown>;
        console.log(`Loading data into activity ${activityId}...`);
        const result = await svc.mcp.loadActivity({
          activity_id: activityId,
          data,
        });
        console.log(
          `${result.success ? "SUCCESS" : "FAILED"} — ${result.fields_set} fields set`,
        );
        if (result.errors.length > 0) {
          console.log("Errors:", result.errors.join(", "));
        }
      });
      break;
    }

    case "drift": {
      const [activityId] = args;
      if (!activityId) {
        console.error("Usage: cartographer drift <activity_id>");
        process.exit(1);
      }
      await withBrowser(async (svc) => {
        console.log(`Checking drift for activity ${activityId}...`);
        const result = await svc.mcp.diffActivity({
          activity_id: activityId,
        });
        console.log(
          `Drift: ${result.has_drift ? "DETECTED" : "none"}, ${result.signals.length} signals`,
        );
        for (const sig of result.signals) {
          console.log(`  - ${sig.signal_type}: ${sig.field_id}`);
        }
      });
      break;
    }

    case "drift-all": {
      await withBrowser(async (svc) => {
        if (!svc.drift) {
          console.error("Drift monitor requires a browser");
          process.exit(1);
        }
        console.log("Checking all verified activities for drift...");
        const results = await svc.drift.checkAll();
        let total = 0;
        for (const r of results) {
          if (r.result.has_drift) {
            total++;
            console.log(
              `  ${r.activity_id}: ${r.result.signals.length} drift signals`,
            );
          }
        }
        console.log(
          `Done. ${total}/${results.length} activities have drift.`,
        );
      });
      break;
    }

    case "list": {
      await withoutBrowser(async (svc) => {
        const result = await svc.mcp.listActivities({});
        if (result.activities.length === 0) {
          console.log("No activities mapped yet.");
          return;
        }
        console.log(`${result.total} activities:\n`);
        for (const a of result.activities) {
          const check = a.verified ? "[verified]" : "[unverified]";
          console.log(
            `  ${a.activity_id}  ${a.name}  ${check}  v${a.version}  ${a.lifecycle_phase}`,
          );
        }
      });
      break;
    }

    case "describe": {
      const [activityId] = args;
      if (!activityId) {
        console.error("Usage: cartographer describe <activity_id>");
        process.exit(1);
      }
      await withoutBrowser(async (svc) => {
        const result = await svc.mcp.describeActivity({
          activity_id: activityId,
        });
        console.log(JSON.stringify(result, null, 2));
      });
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error("Error:", err.message);
  process.exit(1);
});
