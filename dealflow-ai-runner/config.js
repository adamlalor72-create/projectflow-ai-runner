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
    headless: false,    // set true for production, false for debugging
    slowMo: 100,        // ms delay between actions
    timeout: 30000,     // default action timeout
    screenshotDir: "./screenshots",

    // Client certificate subject for auto-selection (local dev only).
    // This is the SAP SSO cert installed in your browser/keychain.
    // Set to "" or null to disable (e.g. on BTP where no cert is needed).
    clientCertSubject: process.env.RUNNER_CERT_SUBJECT || "I075199",
  },
};

export default config;
