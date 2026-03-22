FROM node:22-slim

WORKDIR /app

# Install build tools for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --production

COPY . .

# Create data directory
RUN mkdir -p /data

ENV OWL_HOME=/data
ENV NODE_ENV=production

# Expose dashboard port
EXPOSE 3000

# Default: run daemon in foreground
CMD ["node", "src/daemon/index.js", "--config", "/data/config.json"]
