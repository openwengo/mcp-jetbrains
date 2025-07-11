# Docker Deployment Guide for JetBrains MCP Proxy

This guide provides comprehensive instructions for building and deploying the JetBrains MCP Proxy using Docker.

## Overview

The JetBrains MCP Proxy can be easily deployed using Docker for containerized environments. The Docker image follows security best practices:
- Runs as non-root user (`mcpproxy`)
- Uses minimal Alpine Linux base image (Node 22)
- Contains only production dependencies
- Includes built-in health checks

## Quick Start

### Build the Docker Image

```bash
# Build the production image
docker build -t jetbrains-mcp-proxy:latest .

# Build with a specific tag
docker build -t jetbrains-mcp-proxy:1.8.0 .
```

### Run the Container

```bash
# Run in HTTP mode (default) - for IDE on host machine
docker run -d \
  --name mcp-proxy \
  --network=host \
  jetbrains-mcp-proxy:latest

# Run in stdio mode
docker run -d \
  --name mcp-proxy \
  --network=host \
  -e TRANSPORT_MODE=stdio \
  jetbrains-mcp-proxy:latest

# Run with port mapping (for external access)
docker run -d \
  --name mcp-proxy \
  -p 3000:3000 \
  jetbrains-mcp-proxy:latest
```

## Environment Variables

The Docker container supports all environment variables from the application:

### Core Configuration
- **`TRANSPORT_MODE`**: Transport protocol (`stdio` or `http`, default: `http`)
- **`HTTP_PORT`**: HTTP server port (default: `3000`)
- **`HTTP_HOST`**: Host address to bind to (default: `0.0.0.0`)

### IDE Connection
- **`IDE_PORT`**: Specific IDE port to connect to (overrides auto-discovery)
- **`HOST`**: IDE host address (default: `127.0.0.1`)

### Logging
- **`LOG_ENABLED`**: Enable logging (`true` or `false`, default: `false`)

### Node.js Environment
- **`NODE_ENV`**: Node.js environment (default: `production`)

## Deployment Scenarios

### 1. Standalone HTTP Server

```bash
docker run -d \
  --name mcp-proxy \
  --network=host \
  -e TRANSPORT_MODE=http \
  -e LOG_ENABLED=true \
  jetbrains-mcp-proxy:latest
```

### 2. Connect to Specific IDE

```bash
docker run -d \
  --name mcp-proxy \
  --network=host \
  -e IDE_PORT=63342 \
  -e HOST=127.0.0.1 \
  jetbrains-mcp-proxy:latest
```

### 3. Custom Port Configuration

```bash
docker run -d \
  --name mcp-proxy \
  -p 8080:8080 \
  -e HTTP_PORT=8080 \
  -e HTTP_HOST=0.0.0.0 \
  jetbrains-mcp-proxy:latest
```

### 4. Development Mode with Logging

```bash
docker run -d \
  --name mcp-proxy-dev \
  -p 3000:3000 \
  -e NODE_ENV=development \
  -e LOG_ENABLED=true \
  -e TRANSPORT_MODE=http \
  jetbrains-mcp-proxy:latest
```

## Docker Compose

Create a `docker-compose.yml` file for easier management:

```yaml
version: '3.8'

services:
  mcp-proxy:
    build: .
    container_name: jetbrains-mcp-proxy
    network_mode: host
    environment:
      - TRANSPORT_MODE=http
      - HTTP_PORT=3000
      - HTTP_HOST=0.0.0.0
      - LOG_ENABLED=false
      - NODE_ENV=production
      - HOST=127.0.0.1
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "const http = require('http'); const req = http.request({host: '0.0.0.0', port: 3000, path: '/health', timeout: 2000}, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Development variant with logging
  mcp-proxy-dev:
    build: .
    container_name: jetbrains-mcp-proxy-dev
    network_mode: host
    environment:
      - TRANSPORT_MODE=http
      - HTTP_PORT=3001
      - HTTP_HOST=0.0.0.0
      - LOG_ENABLED=true
      - NODE_ENV=development
      - HOST=127.0.0.1
    restart: unless-stopped
    profiles:
      - dev
```

Run with Docker Compose:

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f mcp-proxy

# Stop services
docker-compose down
```

## Health Checks

The container includes a built-in health check that monitors the `/health` endpoint:

```bash
# Check container health
docker ps

# View health check logs
docker inspect --format='{{json .State.Health}}' mcp-proxy
```

## Networking Considerations

### Connecting to IDE on Host Machine

**Recommended approach**: Use `--network=host` for connecting to IDE on the same machine, as JetBrains IDEs typically listen only on 127.0.0.1:

```bash
# Recommended: Use host networking for local IDE connection
docker run -d \
  --name mcp-proxy \
  --network=host \
  -e HOST=127.0.0.1 \
  -e IDE_PORT=63342 \
  jetbrains-mcp-proxy:latest

# Alternative: Use host.docker.internal (may not work on all systems)
docker run -d \
  --name mcp-proxy \
  -p 3000:3000 \
  -e HOST=host.docker.internal \
  -e IDE_PORT=63342 \
  jetbrains-mcp-proxy:latest
```

**Note**: The `--network=host` option is required when connecting to JetBrains IDEs running on the same machine, as they typically bind only to 127.0.0.1 and are not accessible from within Docker's default bridge network.

### External IDE Connection

For connecting to an IDE on a different machine:

```bash
docker run -d \
  --name mcp-proxy \
  -p 3000:3000 \
  -e HOST=192.168.1.100 \
  -e IDE_PORT=63342 \
  jetbrains-mcp-proxy:latest
```

## Production Deployment

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jetbrains-mcp-proxy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: jetbrains-mcp-proxy
  template:
    metadata:
      labels:
        app: jetbrains-mcp-proxy
    spec:
      containers:
      - name: mcp-proxy
        image: jetbrains-mcp-proxy:latest
        ports:
        - containerPort: 3000
        env:
        - name: TRANSPORT_MODE
          value: "http"
        - name: HTTP_PORT
          value: "3000"
        - name: LOG_ENABLED
          value: "true"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: jetbrains-mcp-proxy-service
spec:
  selector:
    app: jetbrains-mcp-proxy
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

### Docker Swarm

```bash
# Deploy as a service
docker service create \
  --name mcp-proxy \
  --publish 3000:3000 \
  --env TRANSPORT_MODE=http \
  --env LOG_ENABLED=true \
  --replicas 2 \
  jetbrains-mcp-proxy:latest
```

## Troubleshooting

### Common Issues

1. **Container fails to start**
   ```bash
   # Check logs
   docker logs mcp-proxy
   
   # Check if port is already in use
   netstat -tulpn | grep 3000
   ```

2. **Cannot connect to IDE**
   ```bash
   # Test IDE connectivity from container
   docker exec -it mcp-proxy sh
   wget -O- http://$HOST:$IDE_PORT/api/mcp/list_tools
   ```

3. **Health check failing**
   ```bash
   # Test health endpoint manually
   curl http://localhost:3000/health
   
   # Check container health status
   docker inspect mcp-proxy | grep -A 10 Health
   ```

### Debug Mode

Run container with debug output:

```bash
docker run -it --rm \
  -p 3000:3000 \
  -e LOG_ENABLED=true \
  -e NODE_ENV=development \
  jetbrains-mcp-proxy:latest
```

## Security Considerations

The Docker image implements several security best practices:

- **Non-root user**: Container runs as user `mcpproxy` (UID 1001)
- **Minimal base image**: Uses Alpine Linux for smaller attack surface
- **Production dependencies only**: Final image contains only runtime dependencies
- **Signal handling**: Proper signal handling with dumb-init

### Additional Security Measures

```bash
# Run with read-only filesystem
docker run -d \
  --name mcp-proxy \
  --read-only \
  --tmpfs /tmp \
  -p 3000:3000 \
  jetbrains-mcp-proxy:latest

# Limit resources
docker run -d \
  --name mcp-proxy \
  --memory=256m \
  --cpus=0.5 \
  -p 3000:3000 \
  jetbrains-mcp-proxy:latest
```

## Image Information

- **Base Image**: node:22-alpine
- **Final Image Size**: ~50MB (approximate)
- **User**: mcpproxy (UID 1001)
- **Working Directory**: /app
- **Exposed Ports**: 3000
- **Health Check**: Built-in HTTP health check on `/health`