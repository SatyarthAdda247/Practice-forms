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
import re
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
        _lead_access.spec(),
        _marking_access.spec(),
        _scheme_spec(),
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
            # Which paper of that exam — a tier, phase or session. Stored beside
            # the exam because a tier is a different paper with different marking
            # (SSC CGL Tier-I is +2 / -0.5 over 100 questions, Tier-II is +3 / -1
            # over 150), so a Tier-II score read as a Tier-I one is meaningless.
            F("paper", "STRING"),
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
            # 'upload' (response sheet parsed) or 'manual' (typed in), and for an
            # upload, how much the parser got out of the file on its own: which
            # format it was, whether the official key and the marking scheme came
            # from the sheet rather than the keyboard. This is how we tell whether
            # sheet parsing still works as commissions change their layouts.
            F("input_source", "STRING"),
            F("file_kind", "STRING"),
            F("key_detected", "BOOL"),
            F("scheme_detected", "BOOL"),
            # Where the marks that produced this score came from: 'sheet' (the
            # response sheet's own note), 'admin' (a row in
            # tool_keycheck_schemes), 'exam' (the built-in preset), 'manual'
            # (typed in), or 'unknown' — nothing was stored for the exam, so the
            # score used whatever was in the boxes. Counting the 'unknown' rows
            # per exam is how we know which papers still need a marking scheme
            # set, instead of waiting for a candidate to notice.
            F("marking_origin", "STRING"),
            # The paper's own date/time as printed on the sheet. Nothing that
            # identifies the candidate (roll number, name, centre) is ever read
            # out of the sheet, let alone sent here.
            F("test_date", "STRING"),
            F("test_time", "STRING"),
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
        "paper": _text(payload.get("paper"), 32),
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
        "file_kind": _text(payload.get("fileKind"), 16),
        "key_detected": _bool(payload.get("keyDetected")),
        "scheme_detected": _bool(payload.get("schemeDetected")),
        "marking_origin": _text(payload.get("markingOrigin"), 16),
        "test_date": _text(payload.get("testDate"), 32),
        "test_time": _text(payload.get("testTime"), 64),
        "section_summary": _json_text(payload.get("sectionSummary")),
        "user_agent": _text(user_agent, 400),
        "referrer": _text(referrer, 400),
    })


# --------------------------------------------------------------------------- #
# Answer-key checker: where a score sits in the cohort
# --------------------------------------------------------------------------- #
# What this is NOT: the commission's rank list. The only scores this app holds
# are those of candidates who ran the checker, so what comes back is a
# percentile *within that group*. It is returned together with the cohort size
# precisely so the page can say so rather than implying an official rank.
#
# Below KEYCHECK_MIN_COHORT a "rank" is noise — one other candidate would make
# anyone either 1st or 2nd — so it is reported as unavailable instead.
KEYCHECK_MIN_COHORT = int(os.environ.get("BQ_KEYCHECK_MIN_COHORT", "10"))
# How far back to look. Papers are checked in the days after a shift, so a
# window this wide covers a sitting comfortably while keeping the scan bounded
# (the table is day-partitioned, so the filter really does cut bytes read).
KEYCHECK_RANK_DAYS = 180


def keycheck_rank(exam, score, test_date=None, days=KEYCHECK_RANK_DAYS):
    """Cohort rank + percentile for one score. Never raises on "no data".

    Prefers the cohort that sat the *same paper* (same printed test date) and
    falls back to the whole exam when that is too small to say anything — both
    are counted in one query rather than two, so a fallback costs no extra scan.
    """
    from datetime import datetime, timedelta, timezone

    days = max(1, min(int(days), 365))
    # Snapped to midnight so the query is deterministic and BigQuery can serve
    # it from cache — same reasoning as list_leads / db.daily_usage.
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0,
                                                  microsecond=0)
    cutoff = midnight - timedelta(days=days - 1)
    score = float(score)

    rows = _q(
        f"""SELECT
                 COUNT(*)                                        AS exam_n,
                 COUNTIF(score > @score)                          AS exam_better,
                 AVG(score)                                       AS exam_avg,
                 MAX(score)                                       AS exam_top,
                 COUNTIF(same_paper)                              AS paper_n,
                 COUNTIF(same_paper AND score > @score)           AS paper_better,
                 AVG(IF(same_paper, score, NULL))                 AS paper_avg,
                 MAX(IF(same_paper, score, NULL))                 AS paper_top
              FROM (SELECT score,
                           @test_date IS NOT NULL
                             AND test_date = @test_date AS same_paper
                      FROM `{_KEYCHECK_ID}`
                     WHERE exam = @exam
                       AND created_at >= @cutoff
                       AND score IS NOT NULL)""",
        [
            _sp("exam", "STRING", str(exam)[:64]),
            _sp("score", "FLOAT64", score),
            _sp("test_date", "STRING", _text(test_date, 32) or None),
            _sp("cutoff", "TIMESTAMP", cutoff),
        ],
    )
    if not rows:
        return {"available": False, "reason": "no-data"}

    r = rows[0]
    # Same paper when we can identify it, the whole exam otherwise.
    if (r["paper_n"] or 0) >= KEYCHECK_MIN_COHORT:
        basis, n, better = "paper", r["paper_n"], r["paper_better"]
        avg, top = r["paper_avg"], r["paper_top"]
    else:
        basis, n, better = "exam", r["exam_n"], r["exam_better"]
        avg, top = r["exam_avg"], r["exam_top"]

    n = int(n or 0)
    if n < KEYCHECK_MIN_COHORT:
        return {"available": False, "reason": "small-cohort", "cohort": n,
                "minCohort": KEYCHECK_MIN_COHORT}

    better = int(better or 0)
    return {
        "available": True,
        "basis": basis,                      # 'paper' = same test date, 'exam' = all shifts
        "cohort": n,
        "better": better,
        "rank": better + 1,
        # "top X%" — the share of the cohort at or below this score.
        "percentile": round((n - better) / n * 100, 1),
        "avgScore": round(float(avg), 2) if avg is not None else None,
        "topScore": round(float(top), 2) if top is not None else None,
    }


# --------------------------------------------------------------------------- #
# Answer-key checker: marking schemes an admin can change without a deploy
# --------------------------------------------------------------------------- #
# The problem this solves. How a paper is marked is decided in three places, in
# this order of authority:
#
#   1. the marking note printed on the response sheet itself (read in the
#      browser — see parseMarkingNote in answerKey.js);
#   2. a row in THIS table, keyed by exam slug;
#   3. the built-in per-exam preset shipped in answerKey.js.
#
# Plenty of commissions print no marking note at all, and the built-in presets
# deliberately cover only long-standing patterns — so for a new paper there was
# nothing to score by but whatever preset happened to be selected, which is how
# a Punjab Police paper (+1, no penalty) came to be scored as SSC (+2, −0.5).
# Waiting for a frontend deploy to correct that is far too slow: a wrong score
# is live for every candidate who checks that shift in the meantime.
#
# So a row here pins the marks for one exam, takes effect on the next page load,
# and is auditable (who changed it, when, and why). ``enforced`` is the escape
# hatch for the rare case where the sheet's own note is wrong or unparseable:
# normally the sheet wins, and with ``enforced`` this row wins instead.
#
# Written by super admins and by anyone they have added to `tool_marking_access`.
# Read by the *public* tool, so nothing here may carry personal data.
SCHEMES_TABLE = os.environ.get("BQ_TOOL_KEYCHECK_SCHEMES_TABLE",
                               "tool_keycheck_schemes")
_SCHEMES_ID = f"{PROJECT}.{DATASET}.{SCHEMES_TABLE}"

# A public endpoint serves these on every page load of the tool, and they change
# a few times a week at most — so one query per worker per window, not per
# visitor. Short enough that an admin sees their own change go live promptly.
SCHEME_TTL = int(os.environ.get("BQ_KEYCHECK_SCHEME_TTL", "120"))  # seconds
_scheme_cache = {"at": 0.0, "rows": []}

# Sanity bounds. Not the marking rules of any particular commission — just wide
# enough for every real pattern (JEE's +4, UPSC's −0.66, a 500-question paper)
# and narrow enough that a slipped decimal point or a pasted phone number is
# rejected rather than silently applied to thousands of scores.
MAX_MARKS = 100
MAX_QUESTIONS = 500

# Mirrors SLUG in frontend/src/tools/lib/answerKey.js — keep the two in step.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")


def _scheme_spec():
    from google.cloud import bigquery
    F = bigquery.SchemaField
    return (_SCHEMES_ID, [
        # The exam slug from EXAM_OPTIONS in answerKey.js. Slugs are permanent
        # (see the note on CATALOGUE there), which is what makes it safe to use
        # one as a storage key.
        F("exam", "STRING", mode="REQUIRED"),
        # The exam's display name as it was when the row was saved. Denormalised
        # on purpose: the admin list and the audit trail should still read
        # sensibly for a slug that has since been retired from the catalogue.
        #
        # It also does real work for an exam the admin console *created* — a paper
        # announced after the frontend bundle was built, which is the common case
        # in the weeks around a new recruitment. Such a slug is in no catalogue,
        # so this label is the only name the tool has for it, and the public
        # endpoint serves it in order to render the dropdown.
        F("label", "STRING"),
        # Which <optgroup> an admin-created exam appears under — the conducting
        # body, normally. Ignored for an exam that is already in the catalogue,
        # which carries its own grouping.
        F("group_name", "STRING"),
        F("marks_correct", "FLOAT64"),
        F("marks_wrong", "FLOAT64"),
        F("marks_skipped", "FLOAT64"),
        F("total_questions", "INT64"),
        # True: use these marks even when the response sheet states its own.
        F("enforced", "BOOL"),
        # Why this row exists — a link to the notification, usually. Shown to
        # admins only, never to candidates.
        F("note", "STRING"),
        F("updated_by", "STRING"),
        F("updated_at", "TIMESTAMP"),
    ], ["exam"])


def _bust_scheme_cache():
    _scheme_cache["at"] = 0.0


def _marks_number(raw):
    """A marks value as a float, or None. Accepts "1/3" as well as "0.3333".

    Commissions state penalties as fractions ("one-third of a mark"), so that is
    how an admin reading a notification will type one. Rounded to 4dp to match
    the frontend's own reader (marksValue in answerKey.js) — the difference over
    a 200-question paper is far below a printed mark.
    """
    text = str(raw).strip()
    parts = text.split("/")
    if len(parts) == 2:
        num, den = (_float(p) for p in parts)
        if num is None or not den:
            return None
        return round(num / den, 4)
    return _float(text)


def _scheme_row(r):
    return {
        "exam": r["exam"],
        "label": r["label"],
        "group": r["group_name"],
        "correct": r["marks_correct"],
        "wrong": r["marks_wrong"],
        "skipped": r["marks_skipped"],
        "total": r["total_questions"],
        "enforced": bool(r["enforced"]),
        "note": r["note"],
        "updatedBy": r["updated_by"],
        "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
    }


def list_keycheck_schemes(cached=False):
    """Every marking-scheme override, newest change first.

    ``cached=True`` is for the public read path; the admin screen passes False
    so an admin always sees what is actually stored.
    """
    import time as _time

    if cached:
        now = _time.monotonic()
        if now - _scheme_cache["at"] < SCHEME_TTL:
            return _scheme_cache["rows"]

    rows = [_scheme_row(r) for r in _q(
        f"""SELECT exam, label, group_name, marks_correct, marks_wrong,
                   marks_skipped, total_questions, enforced, note, updated_by,
                   updated_at
              FROM `{_SCHEMES_ID}`
             ORDER BY updated_at DESC""")]
    if cached:
        _scheme_cache["rows"] = rows
        _scheme_cache["at"] = _time.monotonic()
    return rows


def public_keycheck_schemes():
    """The overrides the public tool needs, keyed by exam slug.

    The marks, plus the exam's name and grouping — which the browser needs to
    render an exam the console created and this bundle has never heard of.
    ``note``, ``updatedBy`` and ``updatedAt`` are internal and are not served to
    candidates. Never raises: the tool falls back to its built-in presets, which
    is exactly what it did before this table existed.
    """
    try:
        rows = list_keycheck_schemes(cached=True)
    except Exception:
        log.exception("could not read marking schemes; using built-in presets")
        return {}
    return {
        r["exam"]: {
            "correct": r["correct"],
            "wrong": r["wrong"],
            "skipped": r["skipped"],
            "total": r["total"],
            "enforced": r["enforced"],
            "label": r["label"],
            "group": r["group"],
        }
        for r in rows if r["exam"]
    }


def upsert_keycheck_scheme(payload, updated_by):
    """Create or replace one exam's marking scheme. Returns the stored row.

    Values are coerced and bounds-checked here rather than trusted from the
    request, because this is the one table in the app whose contents change a
    number every candidate sees.
    """
    # Not _text(): that truncates, and a silently shortened slug is a different
    # exam — a new row rather than an edit to the one the admin meant. The length
    # cap lives in the pattern instead, so an over-long slug is refused.
    exam = str(payload.get("exam") or "").strip()
    if not exam:
        raise ValueError("exam is required")
    # A slug is a permanent storage key, the cohort key the warehouse groups by,
    # and something the public endpoint hands to every browser — so its shape is
    # enforced rather than assumed. Every catalogue slug already matches.
    if not _SLUG_RE.match(exam):
        raise ValueError("exam must be a slug: lowercase letters, digits and "
                         "hyphens, e.g. punjab-police-constable")

    def marks(field, *, signed=False, required=False):
        raw = payload.get(field)
        if raw is None or raw == "":
            if required:
                raise ValueError(f"{field} is required")
            return None
        value = _marks_number(raw)
        if value is None:
            raise ValueError(f"{field} must be a number, e.g. 0.33 or 1/3")
        if abs(value) > MAX_MARKS:
            raise ValueError(f"{field} must be between "
                             f"{-MAX_MARKS if signed else 0} and {MAX_MARKS}")
        if not signed and value < 0:
            # The penalty is stored as a magnitude, so a minus sign here is
            # nearly always someone copying "−1/3" off a notification.
            hint = (" — enter a penalty as a positive number, e.g. 0.33"
                    if field == "wrong" else "")
            raise ValueError(f"{field} cannot be negative{hint}")
        return value

    # `wrong` is the size of the penalty, not a signed adjustment: 0.33 means a
    # third of a mark is deducted. 0 means the paper has no negative marking,
    # and is stored as 0 rather than left null — "no penalty" is a decision an
    # admin makes, and it has to be distinguishable from "not filled in".
    correct = marks("correct", required=True)
    if not correct:
        raise ValueError("correct must be greater than 0 — a scheme awarding "
                         "nothing for a right answer would score every "
                         "candidate zero")
    wrong = marks("wrong")
    # Skipped is signed: a handful of papers dock a mark for an unattempted
    # question, and one or two award part of one.
    skipped = marks("skipped", signed=True)

    raw_total = payload.get("total")
    total = None
    if raw_total not in (None, ""):
        total = _int(raw_total)
        # Rejected rather than truncated: _int would quietly turn a paper of
        # "12.5 questions" into one of 12, and a silently altered question count
        # is the denominator of every score on that paper.
        if total is None or float(raw_total) != total:
            raise ValueError("total must be a whole number of questions")
        if not 0 < total <= MAX_QUESTIONS:
            raise ValueError(f"total must be between 1 and {MAX_QUESTIONS}")

    row = {
        "exam": exam,
        "label": _text(payload.get("label")),
        "group_name": _text(payload.get("group"), 64),
        "marks_correct": correct,
        "marks_wrong": 0.0 if wrong is None else wrong,
        "marks_skipped": 0.0 if skipped is None else skipped,
        "total_questions": total,
        "enforced": bool(payload.get("enforced")),
        "note": _text(payload.get("note"), 500),
        "updated_by": _text(updated_by),
    }

    _q(f"""MERGE `{_SCHEMES_ID}` T
           USING (SELECT @exam AS exam) S ON T.exam = S.exam
           WHEN MATCHED THEN UPDATE SET
             label = @label, group_name = @group, marks_correct = @correct,
             marks_wrong = @wrong, marks_skipped = @skipped,
             total_questions = @total, enforced = @enforced, note = @note,
             updated_by = @by, updated_at = CURRENT_TIMESTAMP()
           WHEN NOT MATCHED THEN
             INSERT (exam, label, group_name, marks_correct, marks_wrong,
                     marks_skipped, total_questions, enforced, note, updated_by,
                     updated_at)
             VALUES (@exam, @label, @group, @correct, @wrong, @skipped, @total,
                     @enforced, @note, @by, CURRENT_TIMESTAMP())""",
       [
           _sp("exam", "STRING", row["exam"]),
           _sp("label", "STRING", row["label"]),
           _sp("group", "STRING", row["group_name"]),
           _sp("correct", "FLOAT64", row["marks_correct"]),
           _sp("wrong", "FLOAT64", row["marks_wrong"]),
           _sp("skipped", "FLOAT64", row["marks_skipped"]),
           _sp("total", "INT64", row["total_questions"]),
           _sp("enforced", "BOOL", row["enforced"]),
           _sp("note", "STRING", row["note"]),
           _sp("by", "STRING", row["updated_by"]),
       ])
    _bust_scheme_cache()
    # Deliberately noisy: this changes the score every candidate sitting this
    # paper is shown, so an audit needs to be able to reconstruct it later.
    log.warning("KEYCHECK SCHEME SET exam=%s correct=%s wrong=%s skipped=%s "
                "total=%s enforced=%s by=%s",
                row["exam"], row["marks_correct"], row["marks_wrong"],
                row["marks_skipped"], row["total_questions"], row["enforced"],
                row["updated_by"])
    return _scheme_row({**row, "updated_at": None})


def delete_keycheck_scheme(exam, deleted_by=None):
    """Drop one exam's override, so it falls back to its built-in preset."""
    exam = _text(exam, 64)
    if not exam:
        raise ValueError("exam is required")
    _q(f"DELETE FROM `{_SCHEMES_ID}` WHERE exam = @exam",
       [_sp("exam", "STRING", exam)])
    _bust_scheme_cache()
    log.warning("KEYCHECK SCHEME CLEARED exam=%s by=%s", exam, deleted_by)
    return exam


# --------------------------------------------------------------------------- #
# Per-feature email allowlists
# --------------------------------------------------------------------------- #
# Two permissions in this app are held as their own tiny tables rather than as
# columns on the shared `users` table, which other products also read — this
# keeps permissions specific to this app out of shared schema. A super admin
# grants and revokes; nobody else can read or write them.
#
#   tool_lead_access      may see candidate contact details
#   tool_marking_access   may edit the answer-key checker's marking schemes
#
# Both behave identically, so the machinery lives in one class and each
# permission is an instance of it. The module-level lead_* functions below are
# kept as-is because app.py calls them by name.
ACCESS_TABLE = os.environ.get("BQ_TOOL_LEAD_ACCESS_TABLE", "tool_lead_access")
MARKING_ACCESS_TABLE = os.environ.get("BQ_TOOL_MARKING_ACCESS_TABLE",
                                      "tool_marking_access")


class _AccessList:
    """An email allowlist table: grant, revoke, list and check membership.

    The list is tiny and changes rarely, but a check runs on every
    /api/auth/me — i.e. every page load. Querying BigQuery there cost every
    non-super-admin 600-1300ms per request (measured), so the whole list is
    held in-process for a short window instead. Per worker and busted on
    grant/revoke, so a change is live immediately in the worker that made it
    and within :data:`ACCESS_TTL` everywhere else.
    """

    def __init__(self, table):
        self.table_id = f"{PROJECT}.{DATASET}.{table}"
        self._cache = {"at": 0.0, "emails": frozenset()}

    def spec(self):
        from google.cloud import bigquery
        F = bigquery.SchemaField
        return (self.table_id, [
            F("email", "STRING", mode="REQUIRED"),
            F("granted_by", "STRING"),
            F("granted_at", "TIMESTAMP"),
        ], ["email"])

    def _emails(self, force=False):
        import time as _time

        now = _time.monotonic()
        if not force and now - self._cache["at"] < ACCESS_TTL:
            return self._cache["emails"]
        rows = _q(f"SELECT LOWER(email) AS email FROM `{self.table_id}`")
        self._cache["emails"] = frozenset(r["email"] for r in rows if r["email"])
        self._cache["at"] = now
        return self._cache["emails"]

    def bust(self):
        self._cache["at"] = 0.0

    def allows(self, user, cached=True):
        """True if ``user`` is on this list.

        Super admins always are; anyone else needs an explicit grant. Never
        raises — a warehouse problem denies access rather than opening it.

        ``cached=True`` is for the cosmetic flags on /api/auth/me, which only
        decide whether a nav link is drawn and run on every page load. The
        endpoints that actually serve or mutate data pass ``cached=False`` so a
        revoked grant takes effect on the next request rather than up to
        ACCESS_TTL later — the cache must never be what keeps a door open."""
        if not user:
            return False
        if user.get("role") == "super_admin":
            return True
        try:
            return (user.get("email") or "").lower() in self._emails(force=not cached)
        except Exception:
            log.exception("access check failed for %s; denying", self.table_id)
            return False

    def list(self):
        rows = _q(f"SELECT email, granted_by, granted_at FROM `{self.table_id}` "
                  f"ORDER BY granted_at DESC")
        return [{
            "email": r["email"],
            "grantedBy": r["granted_by"],
            "grantedAt": r["granted_at"].isoformat() if r["granted_at"] else None,
        } for r in rows]

    def grant(self, email, granted_by):
        email = (email or "").strip().lower()
        if not email:
            raise ValueError("email is required")
        _q(f"""MERGE `{self.table_id}` T
               USING (SELECT @e AS email) S ON LOWER(T.email) = S.email
               WHEN NOT MATCHED THEN
                 INSERT (email, granted_by, granted_at)
                 VALUES (@e, @by, CURRENT_TIMESTAMP())""",
           [_sp("e", "STRING", email), _sp("by", "STRING", granted_by)])
        self.bust()   # the granting worker sees it at once
        return email

    def revoke(self, email):
        email = (email or "").strip().lower()
        _q(f"DELETE FROM `{self.table_id}` WHERE LOWER(email) = @e",
           [_sp("e", "STRING", email)])
        self.bust()
        return email


_lead_access = _AccessList(ACCESS_TABLE)
_marking_access = _AccessList(MARKING_ACCESS_TABLE)


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


# How long a cached allowlist is trusted for. See _AccessList.
ACCESS_TTL = 60  # seconds


# Leads: candidate contact details.
def can_view_leads(user, cached=True):
    return _lead_access.allows(user, cached=cached)


def list_lead_access():
    return _lead_access.list()


def grant_lead_access(email, granted_by):
    return _lead_access.grant(email, granted_by)


def revoke_lead_access(email):
    return _lead_access.revoke(email)


# Marking schemes: who may change how the answer-key checker scores a paper.
def can_edit_marking(user, cached=True):
    return _marking_access.allows(user, cached=cached)


def list_marking_access():
    return _marking_access.list()


def grant_marking_access(email, granted_by):
    return _marking_access.grant(email, granted_by)


def revoke_marking_access(email):
    return _marking_access.revoke(email)


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
              FROM `{_LEADS_ID}`
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
