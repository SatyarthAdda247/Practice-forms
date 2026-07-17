FROM docker-central.adda247.com/base-images/python3:12:0.0.1

ENV PORT=5000 \
    HOST=0.0.0.0

WORKDIR /app

# App source. Deps are already installed in the base image.
COPY . .

RUN mkdir -p uploads
VOLUME ["/app/uploads"]

EXPOSE 5000

CMD ["sh", "-c", "gunicorn --bind ${HOST:-0.0.0.0}:${PORT:-5000} --workers ${WEB_CONCURRENCY:-4} --timeout 120 app:app"]

# # OMR GradePro backend — production image.
# FROM python:3.12-slim

# ENV PYTHONUNBUFFERED=1 \
#     PYTHONDONTWRITEBYTECODE=1 \
#     PORT=5000 \
#     HOST=0.0.0.0

# WORKDIR /app

# # Install deps first for better layer caching.
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# COPY . .

# # DB is external (BigQuery for users, Cloud SQL/Postgres for exams/sheets/
# # results). Only uploaded scan files are local; mount a volume if they must
# # survive restarts. Provide DATABASE_URL and GOOGLE_APPLICATION_CREDENTIALS
# # (plus the mounted key file) at runtime.
# RUN mkdir -p uploads
# VOLUME ["/app/uploads"]

# EXPOSE 5000

# # Container-level liveness probe against the app's health endpoint.
# HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
#     CMD python -c "import os,urllib.request,sys; \
#         url='http://127.0.0.1:%s/api/health' % os.environ.get('PORT','5000'); \
#         sys.exit(0 if urllib.request.urlopen(url, timeout=4).status==200 else 1)"

# # gunicorn reads $PORT; 4 workers is a sane default for small deployments.
# CMD ["sh", "-c", "gunicorn --bind ${HOST:-0.0.0.0}:${PORT:-5000} --workers ${WEB_CONCURRENCY:-4} --timeout 120 app:app"]
