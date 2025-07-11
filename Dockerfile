# Multi-stage build for JetBrains MCP Proxy
# Stage 1: Build stage
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --ignore-scripts

# Copy source code
COPY src/ ./src/

# Build the TypeScript project
RUN npm run build

# Stage 2: Production stage
FROM node:22-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S mcpproxy && \
    adduser -S mcpproxy -u 1001 -G mcpproxy

# Set working directory
WORKDIR /app

# Copy built application from builder stage first
COPY --from=builder /app/dist ./dist

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy any additional required files
COPY README.md LICENSE ./

# Change ownership to non-root user
RUN chown -R mcpproxy:mcpproxy /app

# Switch to non-root user
USER mcpproxy

# Environment variables with defaults
ENV NODE_ENV=production
ENV TRANSPORT_MODE=http
ENV HTTP_PORT=3000
ENV HTTP_HOST=0.0.0.0
ENV HOST=127.0.0.1
ENV LOG_ENABLED=false

# Expose the default HTTP port
EXPOSE 3000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); const options = { host: process.env.HTTP_HOST || '0.0.0.0', port: process.env.HTTP_PORT || 3000, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { if (res.statusCode === 200) { process.exit(0); } else { process.exit(1); } }); req.on('error', () => process.exit(1)); req.on('timeout', () => process.exit(1)); req.end();"

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Default command
CMD ["node", "dist/src/main.js"]