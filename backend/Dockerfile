# OMR GradePro backend — production image.
#
# Build context is the REPO ROOT (not backend/) — paths below are prefixed with
# backend/ to match, mirroring frontend/Dockerfile. Invoke as:
#   docker build -f backend/Dockerfile -t <tag> .
#
# The image contains ONLY code + deps. No env-specific values are baked in:
# provide GOOGLE_APPLICATION_CREDENTIALS (plus the mounted SA key file) and
# OMR_SECRET at runtime via the K8s ConfigMap/Secret — see
# configmap.backend.*.yaml and secret.backend.*.yaml.example.
FROM docker-central.adda247.com/base-images/python-3-12:0.0.2

ENV PORT=5000 \
    HOST=0.0.0.0

WORKDIR /app

# Install deps first for layer caching. The base image ships most deps, but
# requirements.txt is the source of truth (it now includes google-cloud-bigquery,
# which the base image predates), so install it explicitly.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code. Build context is the repo root, so app.py lands at /app/app.py and
# gunicorn's `app:app` module reference resolves.
COPY backend/ .

RUN mkdir -p uploads
VOLUME ["/app/uploads"]

# gunicorn reads $PORT; 4 workers is a sane default for small deployments.
# Liveness is a K8s livenessProbe against /api/health on the Deployment, not
# a Dockerfile HEALTHCHECK — the kubelet never reads the latter.
CMD ["sh", "-c", "gunicorn --bind ${HOST:-0.0.0.0}:${PORT:-5000} --workers ${WEB_CONCURRENCY:-4} --timeout 120 app:app"]
