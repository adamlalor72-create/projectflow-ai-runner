// DealFlow AI Runner — Configuration

const isCloudFoundry = process.env.CF_RUNNER === "true" || !!process.env.VCAP_APPLICATION;

const config = {
  // BTP API base URL (the API server, not the approuter)
  apiUrl: "https://dealflow-ai-api.cfapps.eu12-002.hana.ondemand.com",

  // Shared API key — must match RUNNER_API_KEY env var on the BTP API server
  // Local:  export DEALFLOW_RUNNER_KEY="your-secret-key"
  // CF:     cf set-env dealflow-ai-runner DEALFLOW_RUNNER_KEY "your-secret-key"
  runnerApiKey: process.env.DEALFLOW_RUNNER_KEY || "",

  // Polling settings
  pollIntervalMs: 10000,  // 10 seconds
  maxRetries: 2,

  // Deployment context
  isCloudFoundry,

  // Playwright settings
  browser: {
    // Always headless on CF; local default is also headless unless HEADLESS=false
    headless: isCloudFoundry ? true : process.env.HEADLESS !== "false",
    slowMo: isCloudFoundry ? 50 : 100,
    timeout: 30000,
    // On CF, screenshots go to logs (no persistent filesystem)
    // On local, screenshots save to ./screenshots/
    screenshotDir: isCloudFoundry ? null : "./screenshots",
  },
};

if (isCloudFoundry) {
  console.log("[Config] Running on Cloud Foundry — headless mode, log-only screenshots");
} else {
  console.log("[Config] Running locally — headless:", config.browser.headless);
}

export default config;
