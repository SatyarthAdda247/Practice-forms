# Deployment — OMR Answer Key Checker (Aspirant Portal)

Deployment-only reference for DevOps. Two containerized services, split-domain,
hybrid database.

- **Repo:** https://github.com/metiseduventures/OMR-Answer-Key-Checker.git
- **Branch:** `main`
- **Environments:** Staging + Prod

| Service  | Domain (Prod)                  | Domain (Staging)       |
|----------|--------------------------------|------------------------|
| Frontend | https://tools.adda247.com      | `<confirm>`            |
| Backend  | https://tools-api.adda247.com  | `<confirm>`            |

> These moved from `aspirant-portal[-api].adda247.com`, which no longer resolves
> (NXDOMAIN) — any env still pointing at the old host fails every API call with
> `ERR_NAME_NOT_RESOLVED`. Both domains now serve **https** (plain http 301s to
> it), so Google sign-in works; see §6 step 3.
>
> ⚠️ Always use the **https** scheme in `VITE_API_BASE_URL`. The page is https,
> so an `http://` API origin is blocked as mixed content and every call fails.

Data stores (both **external**, provisioned per environment):
- **Users** → BigQuery: `adda247-dev.Aspirant_portal.users`
- **Exams / sheets / results** → Cloud SQL **Postgres** (`DATABASE_URL`)

---

## 1. Backend (containerized)

| | |
|---|---|
| Dockerfile | `backend/Dockerfile` |
| Build context | repo root (`.`) — Dockerfile COPY paths are prefixed `backend/` |
| Port | `5000` (listens on `$PORT`, binds `0.0.0.0`) |
| Server | `gunicorn app:app`, 4 workers (`WEB_CONCURRENCY`) |
| Healthcheck | `GET /api/health` → `200 {"status":"ok"}` (interval 30s, timeout 5s, start-period 10s, retries 3) |

Build & push (invoke from the repo root, like the frontend):
```bash
docker build -f backend/Dockerfile -t <registry>/omr-answer-key-checker-be:green .
docker push <registry>/omr-answer-key-checker-be:green
```

All runtime config comes from the ConfigMap (`envFrom`). Same image for both envs.

---

## 2. Frontend (containerized)

| | |
|---|---|
| Dockerfile | `frontend/Dockerfile` |
| Build context | repo root (`.`) — Dockerfile COPY paths are prefixed `frontend/` |
| Port | `8080` (listens on `$PORT`) |
| Server | zero-dependency Node static server (`server.js`), SPA fallback → `index.html` |
| Healthcheck | `GET /healthz` → `200 "ok"` (interval 30s, timeout 5s, start-period 5s, retries 3) |

**Runtime config injection** — Docker only *builds*; no env-specific values are
baked in. The build embeds `__VITE_*__` placeholder tokens; at container start
`docker-entrypoint.sh` replaces them with the ConfigMap values. **One image runs
in both staging and prod** — no `--build-arg` needed.

```bash
docker build -f frontend/Dockerfile -t <registry>/omr-answer-fe:green .
docker push <registry>/omr-answer-fe:green
```

Injected at runtime from the ConfigMap: `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`.

If `VITE_API_BASE_URL` is missing or the placeholder was never substituted,
`frontend/src/api.js` falls back to a hostname→API-origin map (`tools.adda247.com`
→ `https://tools-api.adda247.com`) and logs the misconfiguration, instead of
calling same-origin `/api` which does not exist under split-domain. The
ConfigMap value always wins — add new deployed hosts to that map as a safety net.

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
  OMR_NAME_OCR: "0"          # see "Handwritten-name OCR" below — leave off
  OMR_CORS_ORIGINS: "https://<staging-frontend-domain>"
  GOOGLE_CLIENT_ID: "<OAuth Web client ID>"
  DATABASE_URL: "postgresql://USER:PASSWORD@HOST:5432/DBNAME"
  BQ_PROJECT: "adda247-dev"
  BQ_DATASET: "Aspirant_portal"
  GOOGLE_APPLICATION_CREDENTIALS: "/var/secrets/google/key.json"
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
  OMR_NAME_OCR: "0"          # see "Handwritten-name OCR" below — leave off
  OMR_CORS_ORIGINS: "https://tools.adda247.com"
  GOOGLE_CLIENT_ID: "<OAuth Web client ID>"
  DATABASE_URL: "postgresql://USER:PASSWORD@HOST:5432/DBNAME"
  BQ_PROJECT: "adda247-dev"
  BQ_DATASET: "Aspirant_portal"
  GOOGLE_APPLICATION_CREDENTIALS: "/var/secrets/google/key.json"
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
  VITE_API_BASE_URL: "https://tools-api.adda247.com"
  VITE_GOOGLE_CLIENT_ID: "<OAuth Web client ID>"
```

> The GCP service-account key (`key.json`) cannot be an env value — mount it as a
> file at `GOOGLE_APPLICATION_CREDENTIALS`. Use a Secret volume.
>
> **INVARIANT:** the ConfigMap's `GOOGLE_APPLICATION_CREDENTIALS` must equal the
> volume `mountPath` + `/key.json`. If they disagree the pod crashes at boot with
> `DefaultCredentialsError: File ... was not found`. Here both use
> `/var/secrets/google`.
>
> 1. Create the Secret from the SA JSON key (once per env/namespace):
> ```bash
> kubectl create secret generic omr-answer-key-checker-be-adda-stg-green-gcp-sa \
>   --from-file=key.json=backend/credential/adda247-dev-omr.json \
>   -n <namespace>
> ```
> 2. Mount it in the backend Deployment's pod spec:
> ```yaml
> containers:
>   - name: backend
>     # ...envFrom the ConfigMap above...
>     volumeMounts:
>       - { name: gcp-sa, mountPath: /var/secrets/google, readOnly: true }
> volumes:
>   - name: gcp-sa
>     secret:
>       secretName: omr-answer-key-checker-be-adda-stg-green-gcp-sa
>       items:
>         - { key: key.json, path: key.json }   # -> /var/secrets/google/key.json
> ```
> (Prod: swap `-stg-` → `-prod-` in the secret name.)

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
| `OMR_NAME_OCR` | no | handwritten-name OCR; **off** unless `1` — see below |
| `OMR_TROCR_MODEL` | no | local weights directory, or a Hub id |
| `OMR_TROCR_ALLOW_DOWNLOAD` | no | `1` lets the first upload fetch ~1.4 GB — dev only |
| `GOOGLE_CLIENT_ID` | yes | OAuth Web client ID (same as frontend) |
| `DATABASE_URL` | yes | Cloud SQL Postgres — **app won't start without it** |
| `GOOGLE_APPLICATION_CREDENTIALS` | yes | path to mounted SA key file |
| `BQ_PROJECT` | yes | `adda247-dev` |
| `BQ_DATASET` | no | `Aspirant_portal` (default) |

#### Handwritten-name OCR (`OMR_NAME_OCR`)

Leave it off. It is a fallback used only when a sheet's A–Z name grid is blank,
and it costs a ~1.4 GB TrOCR model **per gunicorn worker**, loaded lazily on the
first upload — inside the request. On a memory-limited pod that is an OOM kill
that takes the whole pod with it: the Service loses its endpoints and the
ingress answers `503` on every route, `/api/health` included, with no CORS
headers — so the browser reports it as "blocked by CORS policy" /
`net::ERR_FAILED` and the upload screen says the server is unreachable. The
symptom appears only in staging/prod; locally there is no memory limit and the
weights are already cached.

To actually enable it: bake the weights into the image and point
`OMR_TROCR_MODEL` at that directory, set `WEB_CONCURRENCY: "1"`, and give the
pod a memory limit of ~4Gi. Never rely on a runtime download —
`OMR_TROCR_ALLOW_DOWNLOAD` stays `0` outside a dev machine.

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
   - Prod: `https://tools.adda247.com`
   - Staging: `https://<staging-frontend-domain>`

   ⚠️ **Google rejects http origins.** Only `http://localhost` is exempt: every
   other authorized JavaScript origin must be `https://`, or Google Identity
   Services refuses to render the sign-in button (`origin_mismatch`). Prod is
   served over https, so this is satisfied — keep it that way when adding envs.
   The unauthenticated public tools need no sign-in and are unaffected.

   The frontend serves `Cross-Origin-Opener-Policy: same-origin-allow-popups`
   on HTML (`frontend/server.js`); GIS hands the credential back from a popup
   via `postMessage`, which Chrome blocks under a stricter COOP. If an ingress
   or WAF overrides COOP on this host, sign-in breaks — don't tighten it.

4. **Shared storage for scans** — ⚠️ **not provisioned today.** Uploads are
   written to `/app/uploads` on the pod's own filesystem (`app.py`,
   `upload_sheets`), while the sheet rows live in a shared database. The
   `VOLUME` line in `backend/Dockerfile` is a no-op under Kubernetes, so unless
   the Deployment mounts something, that path is the container's writable layer.
   Two consequences, both showing up as **`404 scanned file is no longer on the
   server`** from `GET /api/sheets/<id>/image` (the Results dashboard's "view
   scan"):

   - **Pod restart** — the row survives, the file does not. Every scan uploaded
     before the restart is unviewable.
   - **More than one replica** — the upload lands on pod A's disk; the image
     request is load-balanced and may reach pod B, which has never seen it. Both
     symptoms are intermittent and depend on routing, so retrying "sometimes
     works" is the tell.

   Fix by putting the scans somewhere shared: a GCS bucket (the service account
   and `google-cloud-*` deps are already in the image) is the clean option; an
   RWX PersistentVolume also works. A single replica with an RWO PVC removes the
   routing half of the problem but not much else.

---

## 6b. BigQuery: partitioning the sheets/results tables

`init_db()` creates `omr_sheets` and `omr_results` **day-partitioned** (on
`created_at` and `graded_at`) so the admin usage dashboard's date-range query
prunes to the days it asks for. Clustering is on `exam_id` and cannot prune a
timestamp predicate, so without partitioning that query scans every row of the
columns it touches.

**This only applies to tables created from that point on.** BigQuery cannot add
partitioning to an existing table in place, and `create_table(exists_ok=True)`
returns an existing table untouched — so a table created before this change
stays unpartitioned and keeps working, just without pruning. Given the query is
cached and bills BigQuery's 10 MB-per-table minimum on a miss, that is a
non-issue at current volume; migrate only if `omr_sheets` grows into the
multi-GB range.

To migrate an existing table (do it during a quiet window — the swap is not
atomic, and rows written between the copy and the rename are lost):

```sql
CREATE TABLE `adda247-dev.Aspirant_portal.omr_sheets_partitioned`
PARTITION BY DATE(created_at)
CLUSTER BY exam_id, id
AS SELECT * FROM `adda247-dev.Aspirant_portal.omr_sheets`;

-- verify the row counts match, then:
DROP TABLE `adda247-dev.Aspirant_portal.omr_sheets`;
ALTER TABLE `adda247-dev.Aspirant_portal.omr_sheets_partitioned`
  RENAME TO omr_sheets;
```

Repeat for `omr_results`, partitioning by `DATE(graded_at)` and clustering by
`exam_id, sheet_id`.

---

## 7. Open items

- Confirm **staging domains** (frontend + backend) → fill `VITE_API_BASE_URL`
  (frontend stg ConfigMap) and `OMR_CORS_ORIGINS` (backend stg ConfigMap), and
  add the staging frontend origin to the OAuth client.
- `OMR_SECRET` must differ between staging and prod.
- Store secrets (`OMR_SECRET`, `DATABASE_URL`, SA key) in a Secret manager /
  K8s Secret if policy requires — they are shown inline here for clarity.
```
