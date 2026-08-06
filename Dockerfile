FROM node:20-slim

WORKDIR /usr/src/app

# Copy package files first (better caching)
COPY package*.json ./
RUN npm install --production

# Copy app files
COPY . .

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
