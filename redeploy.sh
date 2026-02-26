#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME=${IMAGE_NAME:-wechatreader:latest}
CONTAINER_NAME=${CONTAINER_NAME:-wechatreader}
PORT=${PORT:-3000}

echo "Building ${IMAGE_NAME}..."
docker build -t "${IMAGE_NAME}" .

echo "Stopping old container if exists..."
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "Starting new container..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:3000" \
  -v "$(pwd)/data:/app/data" \
  --restart unless-stopped \
  "${IMAGE_NAME}"

echo "Redeployed: http://localhost:${PORT}"
