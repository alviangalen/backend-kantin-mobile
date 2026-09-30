# =========================================================================
# Eight Canteen Backend API - Multi-Stage Dockerfile
# =========================================================================

# -------------------------------------------------------------------------
# Stage 1: Base (Node.js 22 LTS Alpine)
# -------------------------------------------------------------------------
FROM node:22-alpine AS base

# Install tzdata agar zona waktu server sinkron ke Asia/Jakarta (WIB)
# untuk ketepatan waktu cron job patroli penalti
RUN apk add --no-cache tzdata
ENV TZ=Asia/Jakarta

WORKDIR /app

# Salin manifest dependencies untuk memanfaatkan docker layer cache
COPY package*.json ./

# -------------------------------------------------------------------------
# Stage 2: Development (dengan devDependencies & hot-reload via nodemon)
# -------------------------------------------------------------------------
FROM base AS development
ENV NODE_ENV=development
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# -------------------------------------------------------------------------
# Stage 3: Production (Lean, Secure, Non-root)
# -------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production \
    PORT=3000

# Install hanya dependensi production
RUN npm ci --omit=dev && npm cache clean --force

# Salin kode aplikasi sumber
COPY src/ ./src/

# Gunakan akun non-root bawaan Alpine untuk keamanan
USER node

EXPOSE 3000

# Health check native Node.js ke endpoint /api/v1/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
