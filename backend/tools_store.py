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
KEYCHECK_TABLE = os.environ.get("BQ_TOOL_KEYCHECK_TABLE", "tool_answerkey_checker")

_RESIZER_ID = f"{PROJECT}.{DATASET}.{RESIZER_TABLE}"
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

    return _insert(_RESIZER_ID, {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
        "lead_name": _text(lead.get("name")),
        "lead_phone": _text(lead.get("phone"), 32),
        "lead_exam": _text(lead.get("exam")),
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
