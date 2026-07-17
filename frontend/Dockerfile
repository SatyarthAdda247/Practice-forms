# Aspirant Portal frontend — build the Vite SPA, serve it with a tiny Node
# static server.
#
# Docker ONLY builds. NO environment-specific values are baked in: the build
# uses __VITE_*__ placeholder tokens, and docker-entrypoint.sh replaces them at
# container startup with values from the K8s ConfigMap (VITE_API_BASE_URL,
# VITE_GOOGLE_CLIENT_ID). => one image works for both staging and prod.

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Placeholder tokens only — real values are injected at runtime (see entrypoint).
ENV VITE_API_BASE_URL=__VITE_API_BASE_URL__
ENV VITE_GOOGLE_CLIENT_ID=__VITE_GOOGLE_CLIENT_ID__
RUN npm run build

# ---- runtime stage ----
FROM node:20-alpine
WORKDIR /app

# nginx-free: served by the zero-dependency Node server (no prod deps to install).
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY server.js ./server.js
COPY --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh

# Entrypoint injects runtime config, then starts the server.
# Liveness is a K8s livenessProbe against /healthz on the Deployment, not a
# Dockerfile HEALTHCHECK — the kubelet never reads the latter.
CMD ["./docker-entrypoint.sh"]
