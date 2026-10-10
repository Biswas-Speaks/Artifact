FROM node:20-alpine

WORKDIR /app

# Install production dependencies (layer-cached)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY server/ ./server/
COPY public/  ./public/

EXPOSE 3000

CMD ["node", "server/index.js"]
