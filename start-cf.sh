#!/bin/bash
# DealFlow AI Runner — CF Entrypoint
# Installs Chromium headless shell + required system libs at startup.

set -e

echo "[CF-Start] DealFlow AI Runner starting on Cloud Foundry..."
echo "[CF-Start] Node: $(node --version)"

# Install Playwright Chromium headless shell (small download, cached after first run)
echo "[CF-Start] Installing Playwright Chromium..."
npx playwright install chromium 2>&1 | tail -3

# The cflinuxfs4 stack is missing some Chromium deps. Install them from apt archives.
# We download .deb packages and extract the .so files to a local lib dir.
LIBDIR="$HOME/chromium-libs"
if [ ! -f "$LIBDIR/libnspr4.so" ]; then
  echo "[CF-Start] Installing missing Chromium system libraries..."
  mkdir -p "$LIBDIR" /tmp/debs
  
  APT_BASE="http://archive.ubuntu.com/ubuntu/pool/main"
  DEBS=(
    "$APT_BASE/n/nspr/libnspr4_4.35-0ubuntu0.22.04.1_amd64.deb"
    "$APT_BASE/n/nss/libnss3_3.68.2-0ubuntu1.2_amd64.deb"
    "$APT_BASE/n/nss/libnssutil3_3.68.2-0ubuntu1.2_amd64.deb"
    "$APT_BASE/a/atk1.0/libatk1.0-0_2.36.0-3build1_amd64.deb"
    "$APT_BASE/a/at-spi2-core/libatspi2.0-0_2.44.0-3_amd64.deb"
    "$APT_BASE/libx/libxcomposite/libxcomposite1_0.4.5-1build2_amd64.deb"
    "$APT_BASE/libx/libxdamage/libxdamage1_1.1.5-2build2_amd64.deb"
    "$APT_BASE/libx/libxrandr/libxrandr2_1.5.2-1build1_amd64.deb"
    "$APT_BASE/g/glib2.0/libglib2.0-0_2.72.4-0ubuntu2.3_amd64.deb"
    "$APT_BASE/c/cups/libcups2_2.4.1op1-1ubuntu4.11_amd64.deb"
    "$APT_BASE/libx/libxkbcommon/libxkbcommon0_1.4.0-1_amd64.deb"
    "$APT_BASE/p/pango1.0/libpango-1.0-0_1.50.6+ds-2ubuntu1_amd64.deb"
    "$APT_BASE/a/alsa-lib/libasound2_1.2.6.1-1ubuntu1_amd64.deb"
  )
  
  for url in "${DEBS[@]}"; do
    fname=$(basename "$url")
    curl -sL "$url" -o "/tmp/debs/$fname" 2>/dev/null && \
    dpkg-deb -x "/tmp/debs/$fname" /tmp/debs/extract 2>/dev/null || true
  done
  
  # Copy all .so files to our lib dir
  find /tmp/debs/extract -name "*.so*" -exec cp -n {} "$LIBDIR/" \; 2>/dev/null || true
  rm -rf /tmp/debs
  echo "[CF-Start] Installed $(ls $LIBDIR/*.so* 2>/dev/null | wc -l) library files"
else
  echo "[CF-Start] Chromium libs already cached"
fi

# Add our lib dir to the library path so Chromium can find them
export LD_LIBRARY_PATH="$LIBDIR:${LD_LIBRARY_PATH:-}"

echo "[CF-Start] Starting runner in poll mode..."
exec node runner.js
