#!/bin/bash
# DealFlow AI Runner — CF Entrypoint
# Starts a virtual display (Xvfb) then launches the Playwright runner.
# Xvfb is required because Chromium needs a display server even in "headless" mode
# on some Linux environments (specifically when using persistent context).

set -e

echo "[CF-Start] DealFlow AI Runner starting on Cloud Foundry..."
echo "[CF-Start] Node: $(node --version)"
echo "[CF-Start] Display: setting up Xvfb virtual display..."

# Start virtual framebuffer display on :99
Xvfb :99 -screen 0 1440x900x24 -ac &
XVFB_PID=$!
export DISPLAY=:99

# Give Xvfb a moment to start
sleep 2

echo "[CF-Start] Xvfb running (PID: $XVFB_PID)"
echo "[CF-Start] Installing Playwright browsers if needed..."

# Install Chromium browser (Playwright needs this on first run)
npx playwright install chromium 2>&1 | tail -5

echo "[CF-Start] Starting runner in poll mode..."
node runner.js

# Cleanup on exit
kill $XVFB_PID 2>/dev/null || true
