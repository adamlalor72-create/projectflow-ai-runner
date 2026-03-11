#!/bin/bash
# .profile — runs after CF staging, before app start
# Installs system packages needed for Playwright/Chromium on cflinuxfs4 (Ubuntu 22.04)

echo "[.profile] Installing Chromium system dependencies..."

# cflinuxfs4 is Ubuntu 22.04 — apt-get is available
apt-get update -qq 2>/dev/null || true
apt-get install -y -qq \
  xvfb \
  libgbm1 \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  libatspi2.0-0 \
  fonts-liberation \
  2>/dev/null || true

echo "[.profile] System dependencies installed."
