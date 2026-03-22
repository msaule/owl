# ─── Build stage: compile native dependencies ───
FROM node:22-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --production

# ─── Runtime stage: minimal image ───
FROM node:22-slim

WORKDIR /app

# Only copy what we need
COPY --from=builder /build/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY owl.config.json ./

# Create data directory with correct permissions
RUN mkdir -p /data/logs /data/credentials && \
    chown -R node:node /data

ENV OWL_HOME=/data
ENV NODE_ENV=production

# Expose dashboard port
EXPOSE 3000

# Health check — verifies Node.js can import the world model
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "import('./src/core/world-model.js').then(() => process.exit(0)).catch(() => process.exit(1))"

USER node

COPY --chown=node:node docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh 2>/dev/null || true

ENTRYPOINT ["node"]
CMD ["src/daemon/index.js", "--config", "/data/config.json"]
