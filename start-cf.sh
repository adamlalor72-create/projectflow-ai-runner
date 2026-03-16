#!/bin/bash
# DealFlow AI Runner — CF Entrypoint
# Chromium system libs are bundled in chromium-libs/ (extracted from Playwright Docker image).

set -e

echo "[CF-Start] DealFlow AI Runner starting on Cloud Foundry..."
echo "[CF-Start] Node: $(node --version)"

# Install Playwright Chromium headless shell
echo "[CF-Start] Installing Playwright Chromium..."
npx playwright install chromium 2>&1 | tail -3

# Set LD_LIBRARY_PATH to bundled Chromium system libs
export LD_LIBRARY_PATH="$PWD/chromium-libs:${LD_LIBRARY_PATH:-}"
echo "[CF-Start] LD_LIBRARY_PATH set to include bundled libs ($(ls chromium-libs/*.so* 2>/dev/null | wc -l) files)"

echo "[CF-Start] Starting runner in poll mode..."
exec node runner.js
