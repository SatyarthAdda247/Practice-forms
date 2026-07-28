"""BigQuery storage for the two public standalone tools.

One table per tool, both in the same dataset as everything else
(``adda247-dev.Aspirant_portal`` by default):

    tool_image_resizer        one row per completed resize + captured lead
    tool_answerkey_checker    one row per score analysis

Why this module does not reuse ``db.py``'s query path
-----------------------------------------------------
``db.py`` deliberately uses **DML** (``INSERT``/``MERGE`` via query jobs)
because its rows get UPDATEd and DELETEd later, and BigQuery's streaming buffer
blocks that for ~90 minutes. These two tables are **append-only event logs**:
nothing ever mutates a row. That flips the trade-off, so writes here go through
the streaming API (``insert_rows_json``) instead:

  * no query job per write — a DML INSERT is a billed job and adds seconds of
    latency to a page these tools call on every single use;
  * needs only ``bigquery.tables.updateData``, not ``bigquery.jobs.create``,
    which the service account has historically been missing;
  * both tables are DAY-partitioned on ``created_at`` and clustered, so reads
    stay cheap as they grow.

Both tools are public and unauthenticated, so every string is length-capped
before it is stored and the caller is expected to rate-limit.

Configuration (environment variables)::

    BQ_PROJECT                  default 'adda247-dev'
    BQ_DATASET                  default 'Aspirant_portal'
    BQ_TOOL_RESIZER_TABLE       default 'tool_image_resizer'
    BQ_TOOL_KEYCHECK_TABLE      default 'tool_answerkey_checker'
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

log = logging.getLogger(__name__)

PROJECT = os.environ.get("BQ_PROJECT", "adda247-dev")
DATASET = os.environ.get("BQ_DATASET", "Aspirant_portal")
RESIZER_TABLE = os.environ.get("BQ_TOOL_RESIZER_TABLE", "tool_image_resizer")
# The candidate's contact details live in their own table rather than inside the
# job row: it is the only personal data the tools collect, it is the thing the
# leads page reads, and keeping it separate means that page never has to query a
# table full of unrelated job metadata. Joined back to a job via `job_id`.
LEADS_TABLE = os.environ.get("BQ_TOOL_LEADS_TABLE", "tool_image_resizer_leads")
KEYCHECK_TABLE = os.environ.get("BQ_TOOL_KEYCHECK_TABLE", "tool_answerkey_checker")

_RESIZER_ID = f"{PROJECT}.{DATASET}.{RESIZER_TABLE}"
_LEADS_ID = f"{PROJECT}.{DATASET}.{LEADS_TABLE}"
_KEYCHECK_ID = f"{PROJECT}.{DATASET}.{KEYCHECK_TABLE}"

# Length caps for free-text coming from an unauthenticated form.
MAX_TEXT = 200
MAX_JSON = 20_000

_client_singleton = None


def _client():
    global _client_singleton
    if _client_singleton is None:
        from google.cloud import bigquery
        _client_singleton = bigquery.Client(project=PROJECT)
    return _client_singleton


# --------------------------------------------------------------------------- #
# Coercion helpers — never trust the payload
# --------------------------------------------------------------------------- #
def _text(value, limit=MAX_TEXT):
    if value is None:
        return None
    s = str(value).strip()
    return s[:limit] if s else None


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    # BigQuery rejects NaN/Inf in JSON.
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _bool(value):
    return bool(value) if value is not None else None


def _json_text(value, limit=MAX_JSON):
    if value is None:
        return None
    try:
        s = json.dumps(value, separators=(",", ":"))
    except (TypeError, ValueError):
        return None
    return s[:limit]


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Schema / init
# --------------------------------------------------------------------------- #
def _table_specs():
    """``(table_id, schema, clustering_fields)`` per tool table. Built lazily so
    importing this module never requires the BigQuery SDK."""
    from google.cloud import bigquery
    F = bigquery.SchemaField
    return (
        _access_spec(),
        (_RESIZER_ID, [
            F("id", "STRING", mode="REQUIRED"),
            F("created_at", "TIMESTAMP", mode="REQUIRED"),
            # Lead captured by the download modal.
            F("lead_name", "STRING"),
            F("lead_phone", "STRING"),
            F("lead_exam", "STRING"),
            # What the candidate was targeting.
            F("preset_key", "STRING"),
            F("preset_label", "STRING"),
            F("target_width", "INT64"),
            F("target_height", "INT64"),
            F("target_min_kb", "FLOAT64"),
            F("target_max_kb", "FLOAT64"),
            F("target_dpi", "INT64"),
            # What the tool actually produced.
            F("output_width", "INT64"),
            F("output_height", "INT64"),
            F("output_bytes", "INT64"),
            F("output_quality", "FLOAT64"),
            F("fit_mode", "STRING"),
            F("padded", "BOOL"),
            # The uploaded original (name/size only — the image never leaves
            # the browser and is never stored).
            F("source_name", "STRING"),
            F("source_width", "INT64"),
            F("source_height", "INT64"),
            F("source_bytes", "INT64"),
            # JSON array of {key,status,text} health-check rows.
            F("checks", "STRING"),
            F("user_agent", "STRING"),
            F("referrer", "STRING"),
        ], ["preset_key"]),
        (_LEADS_ID, [
            F("id", "STRING", mode="REQUIRED"),
            F("created_at", "TIMESTAMP", mode="REQUIRED"),
            F("name", "STRING"),
            F("phone", "STRING"),
            F("exam", "STRING"),
            # Which tool produced the lead, and the job row it came from, so the
            # technical detail can be looked up without duplicating it here.
            F("tool", "STRING"),
            F("job_id", "STRING"),
            F("preset_label", "STRING"),
            F("user_agent", "STRING"),
            F("referrer", "STRING"),
        ], ["tool"]),
        (_KEYCHECK_ID, [
            F("id", "STRING", mode="REQUIRED"),
            F("created_at", "TIMESTAMP", mode="REQUIRED"),
            F("exam", "STRING"),
            F("shift", "STRING"),
            F("marks_correct", "FLOAT64"),
            F("marks_wrong", "FLOAT64"),
            F("marks_skipped", "FLOAT64"),
            F("total_questions", "INT64"),
            F("attempted", "INT64"),
            F("correct", "INT64"),
            F("incorrect", "INT64"),
            F("skipped", "INT64"),
            F("unkeyed", "INT64"),
            F("score", "FLOAT64"),
            F("max_score", "FLOAT64"),
            F("accuracy", "FLOAT64"),
            # 'upload' (response sheet parsed) or 'manual' (typed in).
            F("input_source", "STRING"),
            # JSON {section: {correct, incorrect, skipped}} — aggregate only;
            # individual answers are never stored.
            F("section_summary", "STRING"),
            F("user_agent", "STRING"),
            F("referrer", "STRING"),
        ], ["exam"]),
    )


def init():
    """Create both tool tables if absent (idempotent, additive).

    Metadata API only (``create_table``/``update_table``), so it needs
    ``tables.create`` rather than ``jobs.create`` — same reasoning as
    ``db.init_db()``.

    Unlike ``db.init_db()`` this never raises: these tables serve two optional
    public tools, and a dataset permission problem here must not stop the
    Aspirant Portal API from booting. Writes then fail individually and are
    logged."""
    from google.cloud import bigquery
    client = _client()
    for table_id, schema, clustering in _table_specs():
        try:
            table = bigquery.Table(table_id, schema=schema)
            # Event tables are day-partitioned on created_at; the lead-access
            # grant table is a tiny mutable list with no such column, and
            # partitioning it on a missing field makes the create fail.
            if any(f.name == "created_at" for f in schema):
                table.time_partitioning = bigquery.TimePartitioning(
                    type_=bigquery.TimePartitioningType.DAY, field="created_at"
                )
            table.clustering_fields = clustering
            created = client.create_table(table, exists_ok=True)
            _reconcile_columns(client, created, schema)
        except Exception as exc:  # noqa: BLE001 — auxiliary tables, never fatal
            log.warning("tools_store: could not provision %s: %s", table_id, exc)


def _reconcile_columns(client, table, desired_schema):
    """Additively append any missing NULLABLE columns to an existing table, so
    a field added here later shows up without a manual migration."""
    have = {f.name for f in table.schema}
    missing = [f for f in desired_schema if f.name not in have and f.mode != "REQUIRED"]
    if missing:
        table.schema = list(table.schema) + missing
        client.update_table(table, ["schema"])


# --------------------------------------------------------------------------- #
# Writes
# --------------------------------------------------------------------------- #
def _insert(table_id, row):
    """Stream one row. Raises RuntimeError if BigQuery rejects it."""
    errors = _client().insert_rows_json(table_id, [row])
    if errors:
        raise RuntimeError(f"BigQuery rejected the row: {errors}")
    return row["id"]


def save_resizer_lead(payload, user_agent=None, referrer=None):
    """Persist one image-resizer download (lead + job details). Returns the id."""
    lead = payload.get("lead") or {}
    target = payload.get("target") or {}
    output = payload.get("output") or {}
    source = payload.get("source") or {}

    job_id = str(uuid.uuid4())
    now = _now_iso()

    # Personal data goes to the leads table only. The lead_* columns stay in the
    # job table's schema for rows written before this split, but are no longer
    # populated — one home for contact details, not two.
    _insert(_LEADS_ID, {
        "id": str(uuid.uuid4()),
        "created_at": now,
        "name": _text(lead.get("name")),
        "phone": _text(lead.get("phone"), 32),
        "exam": _text(lead.get("exam")),
        "tool": "image-resizer",
        "job_id": job_id,
        "preset_label": _text(target.get("label")),
        "user_agent": _text(user_agent, 400),
        "referrer": _text(referrer, 400),
    })

    return _insert(_RESIZER_ID, {
        "id": job_id,
        "created_at": now,
        "preset_key": _text(payload.get("presetKey"), 64),
        "preset_label": _text(target.get("label")),
        "target_width": _int(target.get("w")),
        "target_height": _int(target.get("h")),
        "target_min_kb": _float(target.get("minKB")),
        "target_max_kb": _float(target.get("maxKB")),
        "target_dpi": _int(target.get("dpi")),
        "output_width": _int(output.get("w")),
        "output_height": _int(output.get("h")),
        "output_bytes": _int(output.get("bytes")),
        "output_quality": _float(output.get("quality")),
        "fit_mode": _text(output.get("mode"), 32),
        "padded": _bool(output.get("padded")),
        "source_name": _text(source.get("name")),
        "source_width": _int(source.get("w")),
        "source_height": _int(source.get("h")),
        "source_bytes": _int(source.get("bytes")),
        "checks": _json_text(payload.get("checks")),
        "user_agent": _text(user_agent, 400),
        "referrer": _text(referrer, 400),
    })


def save_keycheck_result(payload, user_agent=None, referrer=None):
    """Persist one answer-key analysis (aggregates only). Returns the id."""
    scheme = payload.get("scheme") or {}
    stats = payload.get("stats") or {}

    return _insert(_KEYCHECK_ID, {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
        "exam": _text(payload.get("exam"), 64),
        "shift": _text(payload.get("shift")),
        "marks_correct": _float(scheme.get("correct")),
        "marks_wrong": _float(scheme.get("wrong")),
        "marks_skipped": _float(scheme.get("skipped")),
        "total_questions": _int(stats.get("total")),
        "attempted": _int(stats.get("attempted")),
        "correct": _int(stats.get("correct")),
        "incorrect": _int(stats.get("incorrect")),
        "skipped": _int(stats.get("skipped")),
        "unkeyed": _int(stats.get("unkeyed")),
        "score": _float(stats.get("score")),
        "max_score": _float(stats.get("maxScore")),
        "accuracy": _float(stats.get("accuracy")),
        "input_source": _text(payload.get("inputSource"), 32),
        "section_summary": _json_text(payload.get("sectionSummary")),
        "user_agent": _text(user_agent, 400),
        "referrer": _text(referrer, 400),
    })


# --------------------------------------------------------------------------- #
# Leads: read access + listing
# --------------------------------------------------------------------------- #
# Who may see candidate contact details. Held in its own app-owned table rather
# than as a column on the shared `users` table, which other products also read —
# this keeps a permission that is specific to this app out of shared schema.
# A super admin grants and revokes; nobody else can read or write it.
ACCESS_TABLE = os.environ.get("BQ_TOOL_LEAD_ACCESS_TABLE", "tool_lead_access")
_ACCESS_ID = f"{PROJECT}.{DATASET}.{ACCESS_TABLE}"


def _access_spec():
    from google.cloud import bigquery
    F = bigquery.SchemaField
    return (_ACCESS_ID, [
        F("email", "STRING", mode="REQUIRED"),
        F("granted_by", "STRING"),
        F("granted_at", "TIMESTAMP"),
    ], ["email"])


def _q(sql, params=None):
    """Run a read query under the same byte ceiling the rest of the app uses."""
    from google.cloud import bigquery
    cfg = bigquery.QueryJobConfig(query_parameters=params or [],
                                  use_query_cache=True)
    import db as _db
    if _db.MAX_BYTES_BILLED > 0:
        cfg.maximum_bytes_billed = _db.MAX_BYTES_BILLED
    return list(_client().query(sql, job_config=cfg).result())


def _sp(name, type_, value):
    from google.cloud import bigquery
    return bigquery.ScalarQueryParameter(name, type_, value)


# The grant list is tiny and changes rarely, but the check runs on every
# /api/auth/me — i.e. every page load. Querying BigQuery there cost every
# non-super-admin 600-1300ms per request (measured), so the whole list is held
# in-process for a short window instead. Per worker and busted on grant/revoke,
# so a change is live immediately in the worker that made it and within
# ACCESS_TTL everywhere else.
ACCESS_TTL = 60  # seconds
_access_cache = {"at": 0.0, "emails": frozenset()}


def _access_emails(force=False):
    import time as _time

    now = _time.monotonic()
    if not force and now - _access_cache["at"] < ACCESS_TTL:
        return _access_cache["emails"]
    rows = _q(f"SELECT LOWER(email) AS email FROM `{_ACCESS_ID}`")
    _access_cache["emails"] = frozenset(r["email"] for r in rows if r["email"])
    _access_cache["at"] = now
    return _access_cache["emails"]


def _bust_access_cache():
    _access_cache["at"] = 0.0


def can_view_leads(user, cached=True):
    """True if ``user`` may see candidate contact details.

    Super admins always may; anyone else needs an explicit grant. Never raises —
    a warehouse problem denies access rather than opening it.

    ``cached=True`` is for the cosmetic flag on /api/auth/me, which only decides
    whether a nav link is drawn and runs on every page load. The endpoint that
    actually serves the data passes ``cached=False`` so a revoked grant takes
    effect on the next request rather than up to ACCESS_TTL later — the cache
    must never be what keeps a door open."""
    if not user:
        return False
    if user.get("role") == "super_admin":
        return True
    try:
        return (user.get("email") or "").lower() in _access_emails(force=not cached)
    except Exception:
        log.exception("lead-access check failed; denying")
        return False


def list_lead_access():
    rows = _q(f"SELECT email, granted_by, granted_at FROM `{_ACCESS_ID}` "
              f"ORDER BY granted_at DESC")
    return [{
        "email": r["email"],
        "grantedBy": r["granted_by"],
        "grantedAt": r["granted_at"].isoformat() if r["granted_at"] else None,
    } for r in rows]


def grant_lead_access(email, granted_by):
    email = (email or "").strip().lower()
    if not email:
        raise ValueError("email is required")
    _q(f"""MERGE `{_ACCESS_ID}` T
           USING (SELECT @e AS email) S ON LOWER(T.email) = S.email
           WHEN NOT MATCHED THEN
             INSERT (email, granted_by, granted_at)
             VALUES (@e, @by, CURRENT_TIMESTAMP())""",
       [_sp("e", "STRING", email), _sp("by", "STRING", granted_by)])
    _bust_access_cache()   # the granting worker sees it at once
    return email


def revoke_lead_access(email):
    email = (email or "").strip().lower()
    _q(f"DELETE FROM `{_ACCESS_ID}` WHERE LOWER(email) = @e",
       [_sp("e", "STRING", email)])
    _bust_access_cache()
    return email


def list_leads(days=30, limit=500):
    """Recent candidate leads, newest first.

    The cut-off is computed here and passed as a parameter, snapped to midnight,
    so the query is deterministic and BigQuery can serve it from cache — see the
    same reasoning in db.daily_usage."""
    from datetime import datetime, timedelta, timezone
    days = max(1, min(int(days), 365))
    limit = max(1, min(int(limit), 5000))
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0,
                                                  microsecond=0)
    cutoff = midnight - timedelta(days=days - 1)
    rows = _q(
        f"""SELECT created_at, name, phone, exam, tool, preset_label
              FROM `{_ACCESS_ID.rsplit('.', 1)[0]}.{LEADS_TABLE}`
             WHERE created_at >= @cutoff
             ORDER BY created_at DESC
             LIMIT {limit}""",
        [_sp("cutoff", "TIMESTAMP", cutoff)],
    )
    return [{
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
        "name": r["name"],
        "phone": r["phone"],
        "exam": r["exam"],
        "tool": r["tool"],
        "presetLabel": r["preset_label"],
    } for r in rows]
