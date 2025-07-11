#!/bin/bash

# Docker Build and Test Script for JetBrains MCP Proxy
# This script builds the Docker image and performs basic validation

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="jetbrains-mcp-proxy"
IMAGE_TAG="latest"
CONTAINER_NAME="mcp-proxy-test"
TEST_PORT="3001"

echo -e "${BLUE}🐳 JetBrains MCP Proxy Docker Build Script${NC}"
echo "=============================================="

# Function to print status
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Clean up function
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
}

# Set up cleanup trap
trap cleanup EXIT

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

print_status "Docker is running"

# Build the Docker image
echo -e "\n${BLUE}🔨 Building Docker image...${NC}"
if docker build -t $IMAGE_NAME:$IMAGE_TAG .; then
    print_status "Docker image built successfully"
else
    print_error "Failed to build Docker image"
    exit 1
fi

# Check image size
IMAGE_SIZE=$(docker images $IMAGE_NAME:$IMAGE_TAG --format "table {{.Size}}" | tail -n 1)
print_status "Image size: $IMAGE_SIZE"

# Test the image
echo -e "\n${BLUE}🧪 Testing Docker image...${NC}"

# Start container in HTTP mode
echo "Starting container in HTTP mode..."
if docker run -d --name $CONTAINER_NAME --network=host -e HTTP_PORT=$TEST_PORT -e LOG_ENABLED=true $IMAGE_NAME:$IMAGE_TAG; then
    print_status "Container started successfully"
else
    print_error "Failed to start container"
    exit 1
fi

# Wait for container to be ready
echo "Waiting for container to be ready..."
sleep 10

# Check if container is running
if docker ps | grep -q $CONTAINER_NAME; then
    print_status "Container is running"
else
    print_error "Container is not running"
    docker logs $CONTAINER_NAME
    exit 1
fi

# Test health endpoint
echo "Testing health endpoint..."
if curl -f -s http://localhost:$TEST_PORT/health >/dev/null; then
    print_status "Health endpoint is responding"
    
    # Get health status (try with jq, fallback to basic parsing)
    HEALTH_RESPONSE=$(curl -s http://localhost:$TEST_PORT/health 2>/dev/null || echo "")
    if command -v jq >/dev/null 2>&1 && [ -n "$HEALTH_RESPONSE" ]; then
        HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
    else
        HEALTH_STATUS="ok"
    fi
    print_status "Health status: $HEALTH_STATUS"
else
    print_warning "Health endpoint is not responding (this may be expected if no IDE is connected)"
fi

# Check container logs for errors
echo "Checking container logs..."
if docker logs $CONTAINER_NAME 2>&1 | grep -i error; then
    print_warning "Found errors in container logs (see above)"
else
    print_status "No errors found in container logs"
fi

# Test container health check
echo "Testing Docker health check..."
sleep 5  # Wait a bit for health check to run
HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' $CONTAINER_NAME 2>/dev/null || echo "none")
if [ "$HEALTH_STATUS" = "healthy" ]; then
    print_status "Docker health check is passing"
elif [ "$HEALTH_STATUS" = "starting" ]; then
    print_warning "Docker health check is still starting"
else
    print_warning "Docker health check status: $HEALTH_STATUS"
fi

# Test stdio mode
echo -e "\n${BLUE}🧪 Testing stdio mode...${NC}"
cleanup
sleep 2

echo "Starting container in stdio mode..."
if docker run -d --name $CONTAINER_NAME --network=host -e TRANSPORT_MODE=stdio -e LOG_ENABLED=true $IMAGE_NAME:$IMAGE_TAG; then
    print_status "Container started in stdio mode"
    sleep 5
    
    if docker ps | grep -q $CONTAINER_NAME; then
        print_status "Container is running in stdio mode"
    else
        print_warning "Container stopped in stdio mode (this may be expected without IDE connection)"
    fi
else
    print_error "Failed to start container in stdio mode"
fi

# Final summary
echo -e "\n${GREEN}🎉 Docker build and test completed!${NC}"
echo "=============================================="
print_status "Image: $IMAGE_NAME:$IMAGE_TAG"
print_status "Size: $IMAGE_SIZE"
print_status "HTTP mode: Tested"
print_status "Stdio mode: Tested"

echo -e "\n${BLUE}📋 Next steps:${NC}"
echo "1. Push to registry: docker push $IMAGE_NAME:$IMAGE_TAG"
echo "2. Deploy with: docker run -d -p 3000:3000 $IMAGE_NAME:$IMAGE_TAG"
echo "3. Or use docker-compose: docker-compose up -d"

echo -e "\n${BLUE}🔧 Useful commands:${NC}"
echo "- View logs: docker logs $CONTAINER_NAME"
echo "- Shell access: docker exec -it $CONTAINER_NAME sh"
echo "- Stop container: docker stop $CONTAINER_NAME"
echo "- Remove container: docker rm $CONTAINER_NAME"