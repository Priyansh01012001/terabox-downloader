#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install dependencies for Puppeteer/Chromium
apt-get update && apt-get install -y \
libnss3 \
libnspr4 \
libatk1.0-0 \
libatk-bridge2.0-0 \
libcups2 \
libdrm2 \
libxkbcommon0 \
libxcomposite1 \
libxdamage1 \
libxfixes3 \
libxrandr2 \
libgbm1 \
libpango-1.0-0 \
libcairo2 \
libasound2 \
libatspi0 \
libx11-xcb1 \
libxcb-dri3-0
