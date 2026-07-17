# OMR GradePro backend — production image.
# Deps (requirements.txt) are already installed in the base image.
FROM docker-central.adda247.com/base-images/python-3-12:0.0.1

ENV PORT=5000 \
    HOST=0.0.0.0

WORKDIR /app

COPY . .

# DB is external (BigQuery for users, Cloud SQL/Postgres for exams/sheets/
# results). Only uploaded scan files are local; mount a volume if they must
# survive restarts. Provide DATABASE_URL, GOOGLE_APPLICATION_CREDENTIALS
# (plus the mounted key file) and OMR_SECRET at runtime — see
# configmap.backend.*.yaml and secret.backend.*.yaml.example.
RUN mkdir -p uploads
VOLUME ["/app/uploads"]

# gunicorn reads $PORT; 4 workers is a sane default for small deployments.
# Liveness is a K8s livenessProbe against /api/health on the Deployment, not
# a Dockerfile HEALTHCHECK — the kubelet never reads the latter.
CMD ["sh", "-c", "gunicorn --bind ${HOST:-0.0.0.0}:${PORT:-5000} --workers ${WEB_CONCURRENCY:-4} --timeout 120 app:app"]
