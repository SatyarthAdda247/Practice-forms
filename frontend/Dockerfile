# OMR GradePro frontend — build the Vite SPA, serve it with nginx.
#
# VITE_* vars are baked in at BUILD time, so pass them as build args (the image
# is environment-specific: build one image for staging, one for prod):
#   docker build \
#     --build-arg VITE_API_BASE_URL=https://omrchecker-api.adda247.com \
#     --build-arg VITE_GOOGLE_CLIENT_ID=<oauth-web-client-id> \
#     -t omrchecker-frontend .

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_CLIENT_ID
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
