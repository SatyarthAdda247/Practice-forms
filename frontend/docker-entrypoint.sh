#!/bin/sh
set -e

# Runtime config injector: replaces the __VITE_*__ placeholders baked into the
# build with values from the container env (populated by the K8s ConfigMap).
# The SAME image works for staging and prod — only the ConfigMap differs.

: "${VITE_API_BASE_URL:=}"
: "${VITE_GOOGLE_CLIENT_ID:=}"

echo "[entrypoint] injecting runtime config into /app/dist ..."
echo "[entrypoint]   VITE_API_BASE_URL=${VITE_API_BASE_URL}"
find /app/dist/assets -type f -name "*.js" -exec sed -i \
  -e "s|__VITE_API_BASE_URL__|${VITE_API_BASE_URL}|g" \
  -e "s|__VITE_GOOGLE_CLIENT_ID__|${VITE_GOOGLE_CLIENT_ID}|g" \
  {} +

echo "[entrypoint] starting server on port ${PORT:-8080}"
exec node /app/server.js
