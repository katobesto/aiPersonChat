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
RUN cd backend && npm install

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

HEALTHCHECK --interval=10s --timeout=5s --start-period=45s --retries=10 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(r.ok)process.exit(0);else process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
