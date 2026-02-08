# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (Python, make, g++, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    pkgconf \
    cairo-dev \
    pango-dev \
    pixman-dev \
    libpng-dev \
    jpeg-dev \
    giflib-dev \
    freetype-dev

# Copy package files
COPY package*.json ./
COPY bun.lockb* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install only runtime dependencies (nginx for serving static files, LibreOffice for PPTX conversion)
RUN apk add --no-cache \
    nginx \
    libreoffice \
    cairo \
    pango \
    pixman \
    libpng \
    jpeg \
    giflib \
    freetype

# Copy node_modules from builder stage (native modules already compiled)
COPY --from=builder /app/node_modules ./node_modules

# Copy package files (needed for tsx and other runtime dependencies)
COPY package*.json ./

# Copy built frontend files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy server code, database module, and migration scripts
COPY server/ ./server/
COPY database/ ./database/
COPY scripts/ ./scripts/
COPY gcp_credential.json ./

# Copy nginx configuration (replace the entire nginx.conf to ensure proper structure)
COPY nginx-full.conf /etc/nginx/nginx.conf

# Create nginx directories
RUN mkdir -p /var/log/nginx /var/cache/nginx /var/run

# Expose ports
EXPOSE 80 3001

# Create start script to run both nginx and the server
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'set -e' >> /start.sh && \
    echo 'echo "Starting backend server..."' >> /start.sh && \
    echo 'cd /app' >> /start.sh && \
    echo 'npx tsx server/index.ts > /tmp/server.log 2>&1 &' >> /start.sh && \
    echo 'SERVER_PID=$!' >> /start.sh && \
    echo 'echo "Backend server started with PID $SERVER_PID"' >> /start.sh && \
    echo 'sleep 5' >> /start.sh && \
    echo 'if ! kill -0 $SERVER_PID 2>/dev/null; then' >> /start.sh && \
    echo '  echo "ERROR: Backend server failed to start"' >> /start.sh && \
    echo '  cat /tmp/server.log' >> /start.sh && \
    echo '  exit 1' >> /start.sh && \
    echo 'fi' >> /start.sh && \
    echo 'echo "Backend server is running"' >> /start.sh && \
    echo 'echo "Starting nginx..."' >> /start.sh && \
    echo 'trap "echo Stopping services...; kill $SERVER_PID 2>/dev/null; nginx -s quit 2>/dev/null; exit" SIGTERM SIGINT' >> /start.sh && \
    echo 'exec nginx -g "daemon off;"' >> /start.sh && \
    chmod +x /start.sh

CMD ["/start.sh"]
