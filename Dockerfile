# Stage 1: Build the Vite frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --production=false
COPY frontend/ .
RUN npm run build

# Stage 2: Production — Node.js + frontend static files
FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy ALL backend source files (server, db, auth)
COPY backend/server.js ./backend/
COPY backend/db.js ./backend/
COPY backend/auth.js ./backend/

# Copy built frontend (static files served by Express)
COPY --from=frontend-builder /app/frontend/dist ./dist

# Ensure data directory exists for sqlite persistence
RUN mkdir -p /app/backend/data

# Coolify expects the container on port 3000
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "backend/server.js"]
