#!/bin/bash
# DealFlow AI Runner — CF Entrypoint
# Pure headless mode — no Xvfb needed with --headless=new Chromium flag.

set -e

echo "[CF-Start] DealFlow AI Runner starting on Cloud Foundry..."
echo "[CF-Start] Node: $(node --version)"
echo "[CF-Start] Installing Playwright browsers if needed..."

# Install Chromium (runs fast if already cached in droplet)
npx playwright install chromium 2>&1 | tail -3

echo "[CF-Start] Starting runner in poll mode..."
exec node runner.js
