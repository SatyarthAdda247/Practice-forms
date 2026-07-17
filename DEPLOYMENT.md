# Deployment — OMR Answer Key Checker (Aspirant Portal)

Deployment-only reference for DevOps. Two containerized services, split-domain,
hybrid database.

- **Repo:** https://github.com/metiseduventures/OMR-Answer-Key-Checker.git
- **Branch:** `main`
- **Environments:** Staging + Prod

| Service  | Domain (Prod)                            | Domain (Staging)       |
|----------|------------------------------------------|------------------------|
| Frontend | https://aspirant-portal.adda247.com      | `<confirm>`            |
| Backend  | https://aspirant-portal-api.adda247.com  | `<confirm>`            |

Data stores (both **external**, provisioned per environment):
- **Users** → BigQuery: `adda247-dev.Aspirant_portal.users`
- **Exams / sheets / results** → Cloud SQL **Postgres** (`DATABASE_URL`)

---

## 1. Backend (containerized)

| | |
|---|---|
| Dockerfile | `backend/Dockerfile` |
| Build context | `backend/` |
| Port | `5000` (listens on `$PORT`, binds `0.0.0.0`) |
| Server | `gunicorn app:app`, 4 workers (`WEB_CONCURRENCY`) |
| Healthcheck | `GET /api/health` → `200 {"status":"ok"}` (interval 30s, timeout 5s, start-period 10s, retries 3) |

Build & push:
```bash
docker build -t <registry>/omr-answer-key-checker-be:green backend/
docker push <registry>/omr-answer-key-checker-be:green
```

All runtime config comes from the ConfigMap (`envFrom`). Same image for both envs.

---

## 2. Frontend (containerized)

| | |
|---|---|
| Dockerfile | `frontend/Dockerfile` |
| Build context | `frontend/` |
| Port | `8080` (listens on `$PORT`) |
| Server | zero-dependency Node static server (`server.js`), SPA fallback → `index.html` |
| Healthcheck | `GET /healthz` → `200 "ok"` (interval 30s, timeout 5s, start-period 5s, retries 3) |

**Runtime config injection** — Docker only *builds*; no env-specific values are
baked in. The build embeds `__VITE_*__` placeholder tokens; at container start
`docker-entrypoint.sh` replaces them with the ConfigMap values. **One image runs
in both staging and prod** — no `--build-arg` needed.

```bash
docker build -t <registry>/omr-answer-fe:green frontend/
docker push <registry>/omr-answer-fe:green
```

Injected at runtime from the ConfigMap: `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`.

---

## 3. ConfigMaps

### Backend — Staging
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: omr-answer-key-checker-be-adda-stg-green
data:
  HOST: "0.0.0.0"
  PORT: "5000"
  WEB_CONCURRENCY: "4"
  OMR_SECRET: "<random-string-UNIQUE-to-staging>"
  OMR_ALLOWED_DOMAINS: "adda247.com,studyiq.com,addaeducation.com"
  OMR_SUPER_ADMIN_EMAILS: "umesh.rao@adda247.com"
  OMR_ADMIN_EMAILS: ""
  OMR_SESSION_MAX_AGE: "604800"
  OMR_CORS_ORIGINS: "https://<staging-frontend-domain>"
  GOOGLE_CLIENT_ID: "<OAuth Web client ID>"
  DATABASE_URL: "postgresql://USER:PASSWORD@HOST:5432/DBNAME"
  BQ_PROJECT: "adda247-dev"
  BQ_DATASET: "Aspirant_portal"
  GOOGLE_APPLICATION_CREDENTIALS: "/var/secrets/gcp/key.json"
```

### Backend — Prod
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: omr-answer-key-checker-be-adda-prod-green
data:
  HOST: "0.0.0.0"
  PORT: "5000"
  WEB_CONCURRENCY: "4"
  OMR_SECRET: "<random-string-UNIQUE-to-prod>"
  OMR_ALLOWED_DOMAINS: "adda247.com,studyiq.com,addaeducation.com"
  OMR_SUPER_ADMIN_EMAILS: "umesh.rao@adda247.com"
  OMR_ADMIN_EMAILS: ""
  OMR_SESSION_MAX_AGE: "604800"
  OMR_CORS_ORIGINS: "https://aspirant-portal.adda247.com"
  GOOGLE_CLIENT_ID: "<OAuth Web client ID>"
  DATABASE_URL: "postgresql://USER:PASSWORD@HOST:5432/DBNAME"
  BQ_PROJECT: "adda247-dev"
  BQ_DATASET: "Aspirant_portal"
  GOOGLE_APPLICATION_CREDENTIALS: "/var/secrets/gcp/key.json"
```

### Frontend — Staging
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: omr-answer-fe-adda-stg-green
data:
  PORT: "8080"
  VITE_API_BASE_URL: "https://<staging-api-domain>"
  VITE_GOOGLE_CLIENT_ID: "<OAuth Web client ID>"
```

### Frontend — Prod
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: omr-answer-fe-adda-prod-green
data:
  PORT: "8080"
  VITE_API_BASE_URL: "https://aspirant-portal-api.adda247.com"
  VITE_GOOGLE_CLIENT_ID: "<OAuth Web client ID>"
```

> The GCP service-account key (`key.json`) cannot be an env value — mount it as a
> file at `GOOGLE_APPLICATION_CREDENTIALS`. Recommended: a Secret volume.
> ```yaml
> volumeMounts:
>   - { name: gcp-sa, mountPath: /var/secrets/gcp, readOnly: true }
> volumes:
>   - name: gcp-sa
>     secret: { secretName: omr-answer-key-checker-be-adda-stg-green-gcp-sa }
> ```

---

## 4. Deployment wiring

Both services pull config via `envFrom` (ConfigMap keys become container env vars):

```yaml
# Backend container
envFrom:
  - configMapRef: { name: omr-answer-key-checker-be-adda-stg-green }   # -prod-green in prod
readinessProbe: { httpGet: { path: /api/health, port: 5000 }, initialDelaySeconds: 10, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 3 }
livenessProbe:  { httpGet: { path: /api/health, port: 5000 }, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 3 }

# Frontend container
envFrom:
  - configMapRef: { name: omr-answer-fe-adda-stg-green }              # -prod-green in prod
readinessProbe: { httpGet: { path: /healthz, port: 8080 }, initialDelaySeconds: 5, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 3 }
livenessProbe:  { httpGet: { path: /healthz, port: 8080 }, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 3 }
```

---

## 5. Environment variables (reference)

### Backend
| Key | Required | Notes |
|---|---|---|
| `HOST` / `PORT` | yes | `0.0.0.0` / `5000` |
| `WEB_CONCURRENCY` | no | gunicorn workers (default 4) |
| `OMR_SECRET` | yes | session signing — **unique per env** |
| `OMR_ALLOWED_DOMAINS` | yes | bare email domains, comma-separated (no scheme) |
| `OMR_SUPER_ADMIN_EMAILS` | yes | comma-separated |
| `OMR_ADMIN_EMAILS` | no | comma-separated |
| `OMR_SESSION_MAX_AGE` | no | seconds (default 604800) |
| `OMR_CORS_ORIGINS` | yes | the **frontend** origin for this env |
| `GOOGLE_CLIENT_ID` | yes | OAuth Web client ID (same as frontend) |
| `DATABASE_URL` | yes | Cloud SQL Postgres — **app won't start without it** |
| `GOOGLE_APPLICATION_CREDENTIALS` | yes | path to mounted SA key file |
| `BQ_PROJECT` | yes | `adda247-dev` |
| `BQ_DATASET` | no | `Aspirant_portal` (default) |

### Frontend
| Key | Required | Notes |
|---|---|---|
| `PORT` | yes | `8080` |
| `VITE_API_BASE_URL` | yes | backend origin (scheme+host, no `/api`, no trailing slash) |
| `VITE_GOOGLE_CLIENT_ID` | yes | OAuth Web client ID (public) |

---

## 6. External dependencies to provision (per environment)

1. **Cloud SQL (Postgres)** — one instance per env → `DATABASE_URL`. Tables
   (`exams`, `sheets`, `results`) auto-create on startup. Schema reference:
   `backend/schema/postgres.sql`.
2. **BigQuery** — `users` table in `adda247-dev.Aspirant_portal`
   (schema: `backend/schema/bigquery_users.sql`). Service-account key with
   BigQuery read/write on the dataset → mounted at `GOOGLE_APPLICATION_CREDENTIALS`.
3. **Google OAuth client** — add each frontend origin to "Authorized JavaScript
   origins":
   - Prod: `https://aspirant-portal.adda247.com`
   - Staging: `https://<staging-frontend-domain>`

---

## 7. Open items

- Confirm **staging domains** (frontend + backend) → fill `VITE_API_BASE_URL`
  (frontend stg ConfigMap) and `OMR_CORS_ORIGINS` (backend stg ConfigMap), and
  add the staging frontend origin to the OAuth client.
- `OMR_SECRET` must differ between staging and prod.
- Store secrets (`OMR_SECRET`, `DATABASE_URL`, SA key) in a Secret manager /
  K8s Secret if policy requires — they are shown inline here for clarity.
```
