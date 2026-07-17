# Aspirant Portal frontend — build the Vite SPA, serve it with nginx.
#
# VITE_* vars are baked in at BUILD time. The ARG defaults below target the
# PRODUCTION split-domain deployment (frontend and backend on separate domains):
#   Frontend: https://aspirant-portal.adda247.com
#   Backend : https://aspirant-portal-api.adda247.com
#
# A plain `docker build` produces a production image. Override per environment
# (e.g. staging) by passing build args:
#   docker build \
#     --build-arg VITE_API_BASE_URL=https://staging-api.adda247.com \
#     --build-arg VITE_GOOGLE_CLIENT_ID=<oauth-web-client-id> \
#     -t aspirant-portal-frontend .

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Production defaults; override with --build-arg for other environments.
ARG VITE_API_BASE_URL=https://aspirant-portal-api.adda247.com
ARG VITE_GOOGLE_CLIENT_ID=903201516918-273gsp8a45pema0fj3mg84vbveqp2765.apps.googleusercontent.com
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# ---- serve stage ----
# nginx-unprivileged runs as a non-root user (uid 101) and binds an unprivileged
# port — required by Cloud Run / PaaS, which run the container non-root and inject
# $PORT (default 8080).
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Cloud Run/PaaS override PORT at runtime; default to 8080 for local runs.
ENV PORT=8080

# nginx.conf is a template: the base image's docker-entrypoint runs envsubst on it
# at startup, replacing ${PORT} and writing /etc/nginx/conf.d/default.conf.
# ($uri/$host etc. are left intact — only real env vars are substituted.)
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

# Liveness probe hits the /healthz route on the runtime port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null 2>&1 || exit 1
