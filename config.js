// DealFlow AI Runner — Configuration

const config = {
  // BTP API base URL (the API server, not the approuter)
  apiUrl: "https://dealflow-ai-api.cfapps.eu12-002.hana.ondemand.com",

  // Shared API key — must match RUNNER_API_KEY env var on the BTP API server
  // Set via: export DEALFLOW_RUNNER_KEY="your-secret-key"
  runnerApiKey: process.env.DEALFLOW_RUNNER_KEY || "",

  // Polling settings
  pollIntervalMs: 10000,  // 10 seconds
  maxRetries: 2,

  // Playwright settings
  browser: {
    headless: process.env.HEADLESS !== "false",  // default true; set HEADLESS=false for visible browser
    slowMo: 100,        // ms delay between actions
    timeout: 30000,     // default action timeout
    screenshotDir: "./screenshots",
  },
};

export default config;
