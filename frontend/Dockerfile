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
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Liveness probe hits the lightweight /healthz route defined in nginx.conf.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
