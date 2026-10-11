# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production server ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server/ ./server/

# Static public files
COPY public/favicon.ico  ./public/favicon.ico
COPY public/favicon.svg  ./public/favicon.svg
COPY public/favicon.png  ./public/favicon.png
COPY public/robots.txt   ./public/robots.txt

# Built React SPA from frontend stage
COPY --from=frontend-builder /build/public/dist ./public/dist

EXPOSE 3000
CMD ["node", "server/index.js"]
