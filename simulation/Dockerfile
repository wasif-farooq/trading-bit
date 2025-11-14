FROM node:18-alpine

WORKDIR /app

# Copy root package files (simulation uses root dependencies)
COPY package*.json ./
RUN npm ci --only=production

# Copy simulation files
COPY simulation/ ./

# Create data directory
RUN mkdir -p /app/data

# Expose WebSocket port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8081/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
