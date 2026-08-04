# Dockerfile for running server with Puppeteer (Chromium)
FROM node:20-bullseye-slim

# Install deps for puppeteer
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    wget \
    unzip \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production

# Copy app
COPY . .

# Expose port
EXPOSE 3000

# Run
CMD ["node", "server.js"]
