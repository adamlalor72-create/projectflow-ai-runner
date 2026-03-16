# DealFlow AI Runner — Docker image for Kyma deployment
# Uses official Playwright image which includes all Chromium dependencies
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Remove local-only files
RUN rm -f start-cf.sh .profile start.sh 2>/dev/null || true

# Playwright browsers already installed in base image
# Set environment for production
ENV NODE_ENV=production
ENV CF_RUNNER=false
ENV HEADLESS=true

CMD ["node", "runner.js"]
