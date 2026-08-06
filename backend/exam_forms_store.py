"""BigQuery storage for practice exam-form submission tracking.

Reuses the SAME BigQuery project/dataset/credentials as the standalone tools
(tools_store) — which are already configured in production — so tracking works
after a normal deploy with no extra secrets, env vars, or AWS/DynamoDB setup.

Append-only event log (one row per save/sign-in/click). The admin dashboard
reads the latest row per (identifier, exam_id). Day-partitioned on created_at
and clustered, so reads stay cheap as it grows.

Public API (kept stable for app.py):
    save(exam_id, identifier, data, step=, user_agent=, referrer=) -> {"id": ...}
    list_all(limit=, days=) -> [ {identifier, examId, candidateName, ...}, ... ]
    Unavailable  — raised when BigQuery is not reachable/configured.

Config (env, all optional — defaults match the rest of the app):
    BQ_PROJECT               default 'adda247-dev'
    BQ_DATASET               default 'Aspirant_portal'
    BQ_EXAM_FORMS_TABLE      default 'exam_form_submissions'
"""

import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

PROJECT = os.environ.get("BQ_PROJECT", "adda247-dev")
DATASET = os.environ.get("BQ_DATASET", "Aspirant_portal")
TABLE = os.environ.get("BQ_EXAM_FORMS_TABLE", "exam_form_submissions")
_TABLE_ID = f"{PROJECT}.{DATASET}.{TABLE}"

MAX_JSON = 40_000


class Unavailable(RuntimeError):
    """Raised when the submissions store is not reachable/configured.

    Endpoints map this to 503 so a storage outage never breaks a practice run
    (the frontend ignores the response)."""


_client_singleton = None


def _client():
    global _client_singleton
    if _client_singleton is None:
        from google.cloud import bigquery
        _client_singleton = bigquery.Client(project=PROJECT)
    return _client_singleton


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _text(value, limit=256):
    if value is None:
        return None
    s = str(value).strip()
    return s[:limit] if s else None


def _json_text(value, limit=MAX_JSON):
    try:
        s = json.dumps(value, separators=(",", ":"))
    except (TypeError, ValueError):
        return None
    return s[:limit]


# --------------------------------------------------------------------------- #
# Schema / init
# --------------------------------------------------------------------------- #
def init():
    """Create the submissions table if absent (idempotent, additive). Never
    raises — a provisioning problem must not stop the API from booting; writes
    then fail individually and are logged."""
    from google.cloud import bigquery
    F = bigquery.SchemaField
    schema = [
        F("id", "STRING", mode="REQUIRED"),
        F("created_at", "TIMESTAMP", mode="REQUIRED"),
        F("exam_id", "STRING"),
        F("identifier", "STRING"),          # mobile or email — the candidate key
        F("candidate_name", "STRING"),
        F("candidate_phone", "STRING"),
        F("step", "STRING"),
        F("event", "STRING"),               # portal-entry / start-practice-click / form-save
        F("data", "STRING"),                # JSON snapshot of the form fields
        F("user_agent", "STRING"),
        F("referrer", "STRING"),
    ]
    try:
        client = _client()
        table = bigquery.Table(_TABLE_ID, schema=schema)
        table.time_partitioning = bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY, field="created_at"
        )
        table.clustering_fields = ["exam_id", "identifier"]
        created = client.create_table(table, exists_ok=True)
        have = {f.name for f in created.schema}
        missing = [f for f in schema if f.name not in have and f.mode != "REQUIRED"]
        if missing:
            created.schema = list(created.schema) + missing
            client.update_table(created, ["schema"])
    except Exception as exc:  # noqa: BLE001 — auxiliary table, never fatal
        log.warning("exam_forms_store: could not provision %s: %s", _TABLE_ID, exc)


# --------------------------------------------------------------------------- #
# Write
# --------------------------------------------------------------------------- #
def save(exam_id, identifier, data, step=None, user_agent=None, referrer=None):
    """Append one submission/event row. Returns {"id": ...}.

    Raises ValueError on bad input, Unavailable if BigQuery rejects the write."""
    exam_id = str(exam_id or "").strip()
    identifier = str(identifier or "").strip()
    if not exam_id or not identifier:
        raise ValueError("examId and identifier are required")

    d = data if isinstance(data, dict) else {}
    cand_name = _text(d.get("name") or d.get("id:fullname"))
    cand_phone = _text(
        d.get("phone") or d.get("id:txtmobile")
        or (identifier if identifier.isdigit() else None),
        32,
    )
    row = {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
        "exam_id": exam_id[:64],
        "identifier": identifier[:128],
        "candidate_name": cand_name,
        "candidate_phone": cand_phone,
        "step": _text(step, 64),
        "event": _text(d.get("event"), 64),
        "data": _json_text(d),
        "user_agent": _text(user_agent, 400),
        "referrer": _text(referrer, 400),
    }
    try:
        errors = _client().insert_rows_json(_TABLE_ID, [row])
        if errors:
            raise RuntimeError(f"BigQuery rejected the row: {errors}")
    except Unavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise Unavailable(f"BigQuery write failed: {exc}")
    return {"id": row["id"]}


# --------------------------------------------------------------------------- #
# Read (admin dashboard) — latest row per (identifier, exam_id)
# --------------------------------------------------------------------------- #
def list_all(limit=2000, days=365):
    """Every candidate's latest submission, newest-updated first.

    Collapses the append-only log to one row per (identifier, exam_id) — the
    most recent — plus each candidate's first-seen time. Raises Unavailable on a
    warehouse problem."""
    limit = max(1, min(int(limit), 5000))
    days = max(1, min(int(days), 730))
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff = midnight - timedelta(days=days - 1)

    from google.cloud import bigquery
    params = [
        bigquery.ScalarQueryParameter("cutoff", "TIMESTAMP", cutoff),
        bigquery.ScalarQueryParameter("lim", "INT64", limit),
    ]
    sql = f"""
        SELECT identifier, exam_id, candidate_name, candidate_phone, step, event,
               data, first_seen, updated_at
          FROM (
            SELECT identifier, exam_id, candidate_name, candidate_phone, step, event, data,
                   ROW_NUMBER() OVER (PARTITION BY identifier, exam_id ORDER BY created_at DESC) AS rn,
                   MIN(created_at) OVER (PARTITION BY identifier, exam_id) AS first_seen,
                   MAX(created_at) OVER (PARTITION BY identifier, exam_id) AS updated_at
              FROM `{_TABLE_ID}`
             WHERE created_at >= @cutoff
          )
         WHERE rn = 1
         ORDER BY updated_at DESC
         LIMIT @lim
    """
    cfg = bigquery.QueryJobConfig(query_parameters=params, use_query_cache=True)
    try:
        import db as _db
        if getattr(_db, "MAX_BYTES_BILLED", 0) > 0:
            cfg.maximum_bytes_billed = _db.MAX_BYTES_BILLED
    except Exception:  # noqa: BLE001
        pass

    try:
        rows = list(_client().query(sql, job_config=cfg).result())
    except Exception as exc:  # noqa: BLE001
        raise Unavailable(f"BigQuery read failed: {exc}")

    def _epoch(ts):
        try:
            return int(ts.timestamp())
        except Exception:  # noqa: BLE001
            return 0

    out = []
    for r in rows:
        data = {}
        if r["data"]:
            try:
                parsed = json.loads(r["data"])
                if isinstance(parsed, dict):
                    data = parsed
            except (TypeError, ValueError):
                data = {}
        out.append({
            "identifier": r["identifier"] or "",
            "examId": r["exam_id"] or "",
            "candidateName": r["candidate_name"] or "",
            "candidatePhone": r["candidate_phone"] or "",
            "step": r["step"] or "",
            "event": r["event"] or "",
            "createdAt": _epoch(r["first_seen"]),
            "updatedAt": _epoch(r["updated_at"]),
            "data": data,
        })
    return out
