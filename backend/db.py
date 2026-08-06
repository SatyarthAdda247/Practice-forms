"""Persistence layer for OMR GradePro (BigQuery-only).

Everything lives in BigQuery now:

  * **Users** live in the shared ``Aspirant_portal`` dataset — see
    :mod:`bigquery_users`. Those functions are re-exported here so callers can
    keep using ``db.get_user_by_id`` etc.
  * **Exams / sheets / results** live in app-owned BigQuery tables
    (``omr_exams`` / ``omr_sheets`` / ``omr_results`` by default), managed by
    this module.

BigQuery is an analytics warehouse, not an OLTP database, so this module is
written to be safe and cheap for transactional-style access, mirroring
:mod:`bigquery_users`:

  * **DML only** (``INSERT`` / ``UPDATE`` / ``DELETE``) — never the streaming
    API. Streamed rows sit in a buffer and cannot be UPDATE/DELETEd for up to
    ~90 minutes; DML rows are immediately queryable and mutable.
  * Integer primary keys are generated with ``MAX(id) + 1`` (the app's routes
    use ``<int:...>`` ids). This is inherently racy under high concurrency, but
    fine for this low-volume tool.
  * BigQuery has no ``RETURNING`` and no foreign-key cascades, so ids/timestamps
    are generated in Python and cascade deletes are performed explicitly.
"""

import json
import os
import threading
import time
from datetime import datetime, timezone

# Users live in the shared BigQuery dataset; re-export the repo functions so
# callers keep using db.get_user_by_id etc.
from bigquery_users import (  # noqa: F401
    count_super_admins,
    create_local_user,
    create_user,
    delete_user,
    get_user_by_email,
    get_user_by_id,
    get_user_row_by_email,
    list_users,
    row_to_user,
    update_user,
    upsert_user,
)
from bigquery_users import init as _init_users


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
PROJECT = os.environ.get("BQ_PROJECT", "adda247-dev")
DATASET = os.environ.get("BQ_DATASET", "Aspirant_portal")
EXAMS_TABLE = os.environ.get("BQ_EXAMS_TABLE", "omr_exams")
SHEETS_TABLE = os.environ.get("BQ_SHEETS_TABLE", "omr_sheets")
RESULTS_TABLE = os.environ.get("BQ_RESULTS_TABLE", "omr_results")

# Hard per-query cost guardrail. BigQuery bills by bytes *scanned*, so a single
# runaway or accidentally unfiltered query is the only real cost risk here (the
# tables are clustered on the columns every read filters by, and stay tiny). A
# query that would bill more than this is rejected before it runs — it fails
# fast instead of costing money. 1 GB is orders of magnitude above what these
# tables will scan for years; override with BQ_MAX_BYTES_BILLED, or set 0/empty
# to disable the cap.
_max_bytes = os.environ.get("BQ_MAX_BYTES_BILLED", "1000000000").strip()
MAX_BYTES_BILLED = int(_max_bytes) if _max_bytes else 0

# Backtick-quoted forms for embedding in SQL...
_EXAMS = f"`{PROJECT}.{DATASET}.{EXAMS_TABLE}`"
_SHEETS = f"`{PROJECT}.{DATASET}.{SHEETS_TABLE}`"
_RESULTS = f"`{PROJECT}.{DATASET}.{RESULTS_TABLE}`"

# ...and plain `project.dataset.table` forms for the metadata (Table) API.
_EXAMS_ID = f"{PROJECT}.{DATASET}.{EXAMS_TABLE}"
_SHEETS_ID = f"{PROJECT}.{DATASET}.{SHEETS_TABLE}"
_RESULTS_ID = f"{PROJECT}.{DATASET}.{RESULTS_TABLE}"

_client_singleton = None


# --------------------------------------------------------------------------- #
# Client + low-level helpers
# --------------------------------------------------------------------------- #
def _client():
    global _client_singleton
    if _client_singleton is None:
        from google.cloud import bigquery
        _client_singleton = bigquery.Client(project=PROJECT)
    return _client_singleton


def _p(name, type_, value):
    from google.cloud import bigquery
    return bigquery.ScalarQueryParameter(name, type_, value)


def _execute(sql, params=None):
    """Run a query/DML statement. Returns (job, rows) where ``rows`` is a list
    of ``Row`` objects (empty for pure DML).

    Every job runs with the query cache on (repeat reads with identical SQL +
    params return cached results, which BigQuery neither re-scans nor bills) and
    under the ``MAX_BYTES_BILLED`` ceiling so no single statement can rack up an
    unexpected scan cost."""
    from google.cloud import bigquery
    config = bigquery.QueryJobConfig(
        query_parameters=params or [],
        use_query_cache=True,
    )
    if MAX_BYTES_BILLED > 0:
        config.maximum_bytes_billed = MAX_BYTES_BILLED
    job = _client().query(sql, job_config=config)
    rows = list(job.result())
    return job, rows


def _next_id(table_fqn):
    """Generate the next integer primary key via ``MAX(id) + 1`` (one-column
    scan; racy under concurrency — acceptable for this low-volume app)."""
    _, rows = _execute(f"SELECT IFNULL(MAX(id), 0) + 1 AS n FROM {table_fqn}")
    return int(rows[0]["n"]) if rows else 1


def _now():
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Read cache
# --------------------------------------------------------------------------- #
# BigQuery bills by bytes scanned, and ``use_query_cache=True`` already makes a
# repeated read free — but it does NOT make it fast. Every read is still a query
# *job*: create, poll, fetch. Measured against these (tiny) tables that floor is
# ~0.5-1.5s regardless of how little data comes back, and a screen that issues
# two reads pays it twice. That is the whole reason the app felt slow.
#
# So reads are memoised in-process, exactly like the id -> user cache in
# bigquery_users (see BQ_USER_CACHE_TTL there):
#
#   * within TTL          -> returned straight from memory, no job at all
#   * TTL..STALE_TTL      -> the cached value is returned *immediately* and a
#                            daemon thread refreshes it in the background, so
#                            the next caller gets fresh data without anyone
#                            having waited for a job
#   * beyond STALE_TTL    -> fetched synchronously, as before
#
# Every write bumps ``_data_version``, which is part of the cache key, so a
# change made through this process is visible on the very next read — stale data
# can never outlive a write.
#
# CAVEAT, same as the users cache: this is per *process*. Under gunicorn each
# worker has its own, so a write served by worker A is invisible to a read
# served by worker B for up to TTL seconds. That is why the default is short and
# why grading input (:func:`list_validated_sheets`) is deliberately NOT cached —
# scoring must never run against a sheet list that is seconds out of date.
# Set BQ_READ_CACHE_TTL=0 to turn the whole thing off.
READ_CACHE_TTL = int(os.environ.get("BQ_READ_CACHE_TTL", "30"))
READ_CACHE_STALE_TTL = int(os.environ.get("BQ_READ_CACHE_STALE_TTL", "300"))

_read_cache = {}          # (version, key) -> (stored_at, value)
_read_lock = threading.Lock()
_refreshing = set()       # keys with a background refresh already in flight
_data_version = 0


def bust_read_cache():
    """Drop every cached read. Called by all writers in this module."""
    global _data_version
    with _read_lock:
        _data_version += 1
        _read_cache.clear()


def _refresh_async(full_key, loader):
    """Re-run ``loader`` off the request thread and store the result."""
    def run():
        value = None
        ok = False
        try:
            value = loader()
            ok = True
        except Exception:  # a background refresh must never take the app down
            pass
        with _read_lock:
            # Only write back if the entry is still current: a bust while this
            # was running means the version moved on and this value is garbage.
            if ok and full_key in _read_cache:
                _read_cache[full_key] = (time.time(), value)
            _refreshing.discard(full_key)

    threading.Thread(target=run, daemon=True).start()


def _cached(key, loader):
    """Return ``loader()``, memoised under ``key`` (see the notes above)."""
    if READ_CACHE_TTL <= 0:
        return loader()

    full_key = (_data_version, key)
    with _read_lock:
        hit = _read_cache.get(full_key)

    if hit is not None:
        age = time.time() - hit[0]
        if age < READ_CACHE_TTL:
            return hit[1]
        if age < READ_CACHE_STALE_TTL:
            with _read_lock:
                start = full_key not in _refreshing
                if start:
                    _refreshing.add(full_key)
            if start:
                _refresh_async(full_key, loader)
            return hit[1]

    value = loader()
    with _read_lock:
        # Don't store it if a write landed while the query was running: that
        # value predates the write, and caching it would hide the change.
        if full_key[0] == _data_version:
            _read_cache[full_key] = (time.time(), value)
    return value


# Callers get their own copy of a cached row/list, so a caller that mutates what
# it was handed cannot corrupt the entry every later caller will be served.
def _copy_rows(rows):
    return [dict(r) for r in rows]


def _copy_row(row):
    return dict(row) if row is not None else None


# --------------------------------------------------------------------------- #
# Schema / init
# --------------------------------------------------------------------------- #
# Tables are created through the BigQuery *metadata* API (tables.insert via
# client.create_table) rather than a ``CREATE TABLE`` query job. A DDL statement
# is a query job and needs ``bigquery.jobs.create``; table creation via the
# metadata API needs only ``bigquery.tables.create`` on the dataset. Keeping
# init off the jobs path means a service account with dataset-editor rights can
# boot the app and provision its tables even before it is granted job/query
# permissions. (Data operations below still use query jobs and DO require
# ``bigquery.jobs.create``.)
#
# Tables are CLUSTERed on the columns each query filters by, so BigQuery prunes
# to the relevant blocks instead of scanning the whole table on point lookups
# (get_exam WHERE id, list_sheets WHERE exam_id, list_results WHERE exam_id,
# etc.). BigQuery has no indexes; clustering is the lever that keeps these
# transactional-style reads from scanning every row as the tables grow.
def _table_specs():
    """Return ``(table_id, schema_fields, clustering_fields, partition_field)``
    for each app-owned table, using the BigQuery SDK types (built lazily so
    importing this module never requires the SDK).

    ``partition_field`` day-partitions the two tables that are read by date
    range (the usage dashboard). Without it a date filter scans every row of
    the referenced columns, because clustering is on ``exam_id`` and cannot
    prune a timestamp predicate. ``None`` leaves a table unpartitioned."""
    from google.cloud import bigquery
    F = bigquery.SchemaField
    return (
        (_EXAMS_ID, [
            F("id", "INT64", mode="REQUIRED"),
            F("name", "STRING", mode="REQUIRED"),
            F("exam_date", "STRING"),
            F("num_questions", "INT64", mode="REQUIRED"),
            F("marks_correct", "FLOAT64", mode="REQUIRED"),
            F("marks_penalty", "FLOAT64", mode="REQUIRED"),
            F("answer_key", "STRING", mode="REQUIRED"),
            F("created_at", "TIMESTAMP", mode="REQUIRED"),
        ], ["id"], None),
        (_SHEETS_ID, [
            F("id", "INT64", mode="REQUIRED"),
            F("exam_id", "INT64", mode="REQUIRED"),
            F("filename", "STRING", mode="REQUIRED"),
            F("size_bytes", "INT64", mode="REQUIRED"),
            F("status", "STRING", mode="REQUIRED"),
            F("error", "STRING"),
            F("roll_number", "STRING"),
            F("student_name", "STRING"),
            F("answers", "STRING", mode="REQUIRED"),
            # JSON array of filling-rule violation codes (see grading.py).
            F("flags", "STRING"),
            F("created_at", "TIMESTAMP", mode="REQUIRED"),
        ], ["exam_id", "id"], "created_at"),
        (_RESULTS_ID, [
            F("id", "INT64", mode="REQUIRED"),
            F("sheet_id", "INT64", mode="REQUIRED"),
            F("exam_id", "INT64", mode="REQUIRED"),
            F("correct", "INT64", mode="REQUIRED"),
            F("wrong", "INT64", mode="REQUIRED"),
            F("unattempted", "INT64", mode="REQUIRED"),
            F("score", "FLOAT64", mode="REQUIRED"),
            F("max_score", "FLOAT64", mode="REQUIRED"),
            F("graded_at", "TIMESTAMP", mode="REQUIRED"),
        ], ["exam_id", "sheet_id"], "graded_at"),
    )


def init_db():
    """Ensure the exams/sheets/results tables exist in BigQuery (idempotent).

    Uses the metadata API (``create_table(..., exists_ok=True)``) so it does not
    need ``bigquery.jobs.create``. Also provisions the shared users table schema
    via ``bigquery_users.init()``."""
    from google.cloud import bigquery
    _init_users()  # ensure the shared users table exists with a schema
    client = _client()
    for table_id, schema, clustering, partition_field in _table_specs():
        table = bigquery.Table(table_id, schema=schema)
        table.clustering_fields = clustering
        if partition_field:
            # Only takes effect for tables created from here on:
            # create_table(exists_ok=True) returns an existing table untouched,
            # and BigQuery cannot add partitioning to a table in place. See
            # DEPLOYMENT.md for migrating a table that predates this.
            table.time_partitioning = bigquery.TimePartitioning(
                type_=bigquery.TimePartitioningType.DAY, field=partition_field
            )
        created = client.create_table(table, exists_ok=True)
        _reconcile_columns(client, created, schema)


def _reconcile_columns(client, table, desired_schema):
    """Additively add any missing (nullable) columns to an existing table.

    ``create_table(exists_ok=True)`` returns the *existing* table untouched, so
    columns introduced after a table was first created (e.g. ``flags``) would
    otherwise never appear. BigQuery permits appending NULLABLE columns in
    place; we never drop or retype existing ones."""
    have = {f.name for f in table.schema}
    missing = [f for f in desired_schema if f.name not in have]
    if not missing:
        return
    for f in missing:
        if f.mode == "REQUIRED":
            # Can't add a REQUIRED column to a populated table; skip loudly
            # rather than fail boot. (No such case today.)
            continue
    table.schema = list(table.schema) + [f for f in missing if f.mode != "REQUIRED"]
    client.update_table(table, ["schema"])


# --------------------------------------------------------------------------- #
# Serialisation for the transactional tables
# --------------------------------------------------------------------------- #
def _ts(value):
    """Render a timestamp column as an ISO string."""
    return value.isoformat() if hasattr(value, "isoformat") else value


def row_to_exam(row):
    """Serialise an ``exams`` row (dict) to a JSON-friendly dict."""
    return {
        "id": row["id"],
        "name": row["name"],
        "date": row["exam_date"],
        "numQuestions": row["num_questions"],
        "marksCorrect": row["marks_correct"],
        "marksPenalty": row["marks_penalty"],
        "answerKey": json.loads(row["answer_key"]),
        "createdAt": _ts(row["created_at"]),
    }


def row_to_sheet(row):
    """Serialise a ``sheets`` row (dict) to a JSON-friendly dict."""
    return {
        "id": row["id"],
        "examId": row["exam_id"],
        "filename": row["filename"],
        "sizeBytes": row["size_bytes"],
        "status": row["status"],
        "error": row["error"],
        "rollNumber": row["roll_number"],
        "studentName": row["student_name"],
        "answers": json.loads(row["answers"]),
        "flags": json.loads(row["flags"]) if row.get("flags") else [],
        "createdAt": _ts(row["created_at"]),
    }


# --------------------------------------------------------------------------- #
# Exams
# --------------------------------------------------------------------------- #
def _query_exams():
    _, rows = _execute(
        f"SELECT id, name, exam_date, num_questions, marks_correct, "
        f"marks_penalty, answer_key, created_at FROM {_EXAMS} ORDER BY id DESC"
    )
    return [dict(r) for r in rows]


def list_exams():
    """All exams as physical-column dicts, newest first (cached)."""
    return _copy_rows(_cached("exams", _query_exams))


def _query_exam(exam_id):
    _, rows = _execute(
        f"SELECT id, name, exam_date, num_questions, marks_correct, "
        f"marks_penalty, answer_key, created_at FROM {_EXAMS} "
        f"WHERE id = @id LIMIT 1",
        [_p("id", "INT64", exam_id)],
    )
    return dict(rows[0]) if rows else None


def get_exam(exam_id):
    """A single exam as a physical-column dict, or ``None`` (cached)."""
    return _copy_row(_cached(("exam", exam_id), lambda: _query_exam(exam_id)))


def create_exam(name, exam_date, num_questions, marks_correct, marks_penalty,
                answer_key):
    """Insert an exam and return it as a physical-column dict. ``answer_key`` is
    a dict, stored as a JSON string."""
    exam_id = _next_id(_EXAMS)
    created_at = _now()
    _execute(
        f"""INSERT INTO {_EXAMS}
            (id, name, exam_date, num_questions, marks_correct, marks_penalty,
             answer_key, created_at)
            VALUES (@id, @name, @exam_date, @num_questions, @marks_correct,
                    @marks_penalty, @answer_key, @created_at)""",
        [
            _p("id", "INT64", exam_id),
            _p("name", "STRING", name),
            _p("exam_date", "STRING", exam_date),
            _p("num_questions", "INT64", int(num_questions)),
            _p("marks_correct", "FLOAT64", float(marks_correct)),
            _p("marks_penalty", "FLOAT64", float(marks_penalty)),
            _p("answer_key", "STRING", json.dumps(answer_key)),
            _p("created_at", "TIMESTAMP", created_at),
        ],
    )
    bust_read_cache()
    return {
        "id": exam_id,
        "name": name,
        "exam_date": exam_date,
        "num_questions": int(num_questions),
        "marks_correct": float(marks_correct),
        "marks_penalty": float(marks_penalty),
        "answer_key": json.dumps(answer_key),
        "created_at": created_at,
    }


def update_exam(exam_id, name, exam_date, num_questions, marks_correct,
                marks_penalty, answer_key):
    """Update all mutable fields of an exam. Returns the refreshed row dict, or
    ``None`` if the exam no longer exists."""
    _execute(
        f"""UPDATE {_EXAMS} SET
                name = @name, exam_date = @exam_date,
                num_questions = @num_questions, marks_correct = @marks_correct,
                marks_penalty = @marks_penalty, answer_key = @answer_key
            WHERE id = @id""",
        [
            _p("id", "INT64", exam_id),
            _p("name", "STRING", name),
            _p("exam_date", "STRING", exam_date),
            _p("num_questions", "INT64", int(num_questions)),
            _p("marks_correct", "FLOAT64", float(marks_correct)),
            _p("marks_penalty", "FLOAT64", float(marks_penalty)),
            _p("answer_key", "STRING", json.dumps(answer_key)),
        ],
    )
    bust_read_cache()  # before the re-read, so it cannot serve the old row
    return get_exam(exam_id)


def delete_exam(exam_id):
    """Delete an exam and cascade-remove its sheets and results (no FKs in
    BigQuery). Returns ``True`` if the exam existed."""
    _execute(f"DELETE FROM {_RESULTS} WHERE exam_id = @id",
             [_p("id", "INT64", exam_id)])
    _execute(f"DELETE FROM {_SHEETS} WHERE exam_id = @id",
             [_p("id", "INT64", exam_id)])
    job, _ = _execute(f"DELETE FROM {_EXAMS} WHERE id = @id",
                      [_p("id", "INT64", exam_id)])
    bust_read_cache()
    return bool(job.num_dml_affected_rows)


# --------------------------------------------------------------------------- #
# Sheets
# --------------------------------------------------------------------------- #
def _query_sheets(exam_id):
    _, rows = _execute(
        f"SELECT id, exam_id, filename, size_bytes, status, error, "
        f"roll_number, student_name, answers, flags, created_at FROM {_SHEETS} "
        f"WHERE exam_id = @exam_id ORDER BY id DESC",
        [_p("exam_id", "INT64", exam_id)],
    )
    return [dict(r) for r in rows]


def list_sheets(exam_id, cached=True):
    """All sheets for an exam as physical-column dicts, newest first.

    ``cached=False`` forces a live read. The upload client uses it to ask "did
    this file land?" after the server dropped a request — an answer from another
    worker's cache could predate the upload and get the file sent twice.
    """
    if not cached:
        return _query_sheets(exam_id)
    return _copy_rows(_cached(("sheets", exam_id), lambda: _query_sheets(exam_id)))


# Deliberately uncached — this is what grading scores. See the read-cache notes.
def list_validated_sheets(exam_id):
    """Sheets for an exam with status ``validated`` (grading input)."""
    _, rows = _execute(
        f"SELECT id, exam_id, filename, size_bytes, status, error, "
        f"roll_number, student_name, answers, flags, created_at FROM {_SHEETS} "
        f"WHERE exam_id = @exam_id AND status = 'validated'",
        [_p("exam_id", "INT64", exam_id)],
    )
    return [dict(r) for r in rows]


def create_sheet(exam_id, filename, size_bytes, status, error=None,
                 roll_number=None, student_name=None, answers=None, flags=None):
    """Insert a sheet and return it as a physical-column dict. ``answers`` is a
    dict (defaults to ``{}``) and ``flags`` is a list of violation codes
    (defaults to ``[]``); both are stored as JSON strings."""
    sheet_id = _next_id(_SHEETS)
    created_at = _now()
    answers_json = json.dumps(answers or {})
    flags_json = json.dumps(flags or [])
    _execute(
        f"""INSERT INTO {_SHEETS}
            (id, exam_id, filename, size_bytes, status, error, roll_number,
             student_name, answers, flags, created_at)
            VALUES (@id, @exam_id, @filename, @size_bytes, @status, @error,
                    @roll_number, @student_name, @answers, @flags, @created_at)""",
        [
            _p("id", "INT64", sheet_id),
            _p("exam_id", "INT64", exam_id),
            _p("filename", "STRING", filename),
            _p("size_bytes", "INT64", int(size_bytes)),
            _p("status", "STRING", status),
            _p("error", "STRING", error),
            _p("roll_number", "STRING", roll_number),
            _p("student_name", "STRING", student_name),
            _p("answers", "STRING", answers_json),
            _p("flags", "STRING", flags_json),
            _p("created_at", "TIMESTAMP", created_at),
        ],
    )
    bust_read_cache()
    return {
        "id": sheet_id,
        "exam_id": exam_id,
        "filename": filename,
        "size_bytes": int(size_bytes),
        "status": status,
        "error": error,
        "roll_number": roll_number,
        "student_name": student_name,
        "answers": answers_json,
        "flags": flags_json,
        "created_at": created_at,
    }


def _query_sheet(sheet_id):
    _, rows = _execute(
        f"SELECT id, exam_id, filename, size_bytes, status, error, "
        f"roll_number, student_name, answers, flags, created_at FROM {_SHEETS} "
        f"WHERE id = @id LIMIT 1",
        [_p("id", "INT64", sheet_id)],
    )
    return dict(rows[0]) if rows else None


def get_sheet(sheet_id):
    """A single sheet as a physical-column dict, or ``None`` (cached)."""
    return _copy_row(_cached(("sheet", sheet_id), lambda: _query_sheet(sheet_id)))


def update_sheet_identity(sheet_id, student_name=None, roll_number=None):
    """Set a sheet's manually-entered ``student_name`` / ``roll_number``.

    Only fields passed as non-``None`` are changed. Returns the refreshed sheet
    dict, or ``None`` if the sheet doesn't exist. This is a manual override of
    what OCR read (or didn't); it never touches ``answers`` or grading."""
    sets, params = [], [_p("id", "INT64", sheet_id)]
    if student_name is not None:
        sets.append(f"student_name = @student_name")
        params.append(_p("student_name", "STRING", student_name))
    if roll_number is not None:
        sets.append(f"roll_number = @roll_number")
        params.append(_p("roll_number", "STRING", roll_number))
    if not sets:
        return get_sheet(sheet_id)
    _execute(f"UPDATE {_SHEETS} SET {', '.join(sets)} WHERE id = @id", params)
    bust_read_cache()  # before the re-read, so it cannot serve the old row
    return get_sheet(sheet_id)


def delete_sheet(sheet_id):
    """Delete a sheet and its result (no FKs in BigQuery). Returns ``True`` if
    the sheet existed."""
    _execute(f"DELETE FROM {_RESULTS} WHERE sheet_id = @id",
             [_p("id", "INT64", sheet_id)])
    job, _ = _execute(f"DELETE FROM {_SHEETS} WHERE id = @id",
                      [_p("id", "INT64", sheet_id)])
    bust_read_cache()
    return bool(job.num_dml_affected_rows)


# --------------------------------------------------------------------------- #
# Results
# --------------------------------------------------------------------------- #
def replace_results(exam_id, results):
    """Replace all results for an exam in two DML statements (one DELETE, one
    multi-row INSERT) to stay well within BigQuery DML quotas.

    ``results`` is a list of dicts with keys: ``sheetId``, ``correct``,
    ``wrong``, ``unattempted``, ``score``, ``maxScore``.
    """
    _execute(f"DELETE FROM {_RESULTS} WHERE exam_id = @exam_id",
             [_p("exam_id", "INT64", exam_id)])
    bust_read_cache()
    if not results:
        return 0

    base_id = _next_id(_RESULTS)
    graded_at = _now()
    tuples, params = [], [_p("exam_id", "INT64", exam_id),
                          _p("graded_at", "TIMESTAMP", graded_at)]
    for i, r in enumerate(results):
        tuples.append(
            f"(@id{i}, @sheet{i}, @exam_id, @c{i}, @w{i}, @u{i}, @s{i}, "
            f"@m{i}, @graded_at)"
        )
        params += [
            _p(f"id{i}", "INT64", base_id + i),
            _p(f"sheet{i}", "INT64", r["sheetId"]),
            _p(f"c{i}", "INT64", int(r["correct"])),
            _p(f"w{i}", "INT64", int(r["wrong"])),
            _p(f"u{i}", "INT64", int(r["unattempted"])),
            _p(f"s{i}", "FLOAT64", float(r["score"])),
            _p(f"m{i}", "FLOAT64", float(r["maxScore"])),
        ]
    _execute(
        f"""INSERT INTO {_RESULTS}
            (id, sheet_id, exam_id, correct, wrong, unattempted, score,
             max_score, graded_at)
            VALUES {', '.join(tuples)}""",
        params,
    )
    bust_read_cache()
    return len(results)


def _query_results(exam_id):
    _, rows = _execute(
        f"""SELECT r.sheet_id AS sheet_id, s.roll_number AS roll_number,
                   s.student_name AS student_name, s.filename AS filename,
                   s.flags AS flags,
                   r.correct AS correct, r.wrong AS wrong,
                   r.unattempted AS unattempted, r.score AS score,
                   r.max_score AS max_score
              FROM {_RESULTS} r
              JOIN {_SHEETS} s ON s.id = r.sheet_id
             WHERE r.exam_id = @exam_id
             ORDER BY r.score DESC""",
        [_p("exam_id", "INT64", exam_id)],
    )
    return [dict(r) for r in rows]


def list_results(exam_id):
    """Results joined with their sheet metadata, highest score first (cached).
    Returns dicts with keys: ``sheet_id``, ``roll_number``, ``student_name``,
    ``filename``, ``flags``, ``correct``, ``wrong``, ``unattempted``,
    ``score``, ``max_score``."""
    return _copy_rows(_cached(("results", exam_id), lambda: _query_results(exam_id)))


# --------------------------------------------------------------------------- #
# Usage analytics
# --------------------------------------------------------------------------- #
def daily_usage(days=30):
    """Per-day OMR processing volume for the admin dashboard.

    One row per calendar day (UTC) for the last ``days`` days, newest first::

        {"day": "2026-07-27", "sheets": 42, "validated": 40, "failed": 2,
         "graded": 38, "exams": 3, "students": 40}

    Days with no activity are omitted rather than zero-filled — the caller
    renders the calendar, and sending only the non-empty days keeps the
    response small for long ranges.

    ``sheets`` counts every uploaded page (one page = one student's sheet);
    ``graded`` counts those that made it through scoring on that day, which can
    differ because grading is a separate step run later.

    Cached like the other reads — this is the heaviest query in the app and the
    dashboard re-runs it on every visit and range change.
    """
    days = max(1, min(int(days), 365))
    return _copy_rows(_cached(("usage", days), lambda: _query_daily_usage(days)))


def _query_daily_usage(days):
    # Cut-off is computed here and passed as a parameter, deliberately NOT with
    # CURRENT_TIMESTAMP() in SQL. A query containing CURRENT_TIMESTAMP() is
    # non-deterministic, so BigQuery refuses to cache it: measured, the
    # CURRENT_TIMESTAMP form billed the 10 MB minimum on *every* dashboard
    # load, while the parameterised form billed 0 from the second call on.
    #
    # It is also snapped to midnight UTC rather than "now minus N days". An
    # exact-instant cut-off changes on every request, which would miss the
    # cache just as badly; snapped to a day boundary, every request for the
    # same range on the same day is byte-identical and free after the first.
    # Comparing the raw column against a timestamp (rather than wrapping it in
    # DATE()) also keeps it able to prune date partitions.
    from datetime import datetime, timedelta, timezone

    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0,
                                                  microsecond=0)
    cutoff = midnight - timedelta(days=days - 1)

    _, rows = _execute(
        f"""
        WITH uploads AS (
          SELECT DATE(created_at) AS day,
                 COUNT(*) AS sheets,
                 COUNTIF(status = 'validated') AS validated,
                 COUNTIF(status = 'failed') AS failed,
                 COUNT(DISTINCT exam_id) AS exams,
                 COUNTIF(student_name IS NOT NULL AND student_name != '') AS named
            FROM {_SHEETS}
           WHERE created_at >= @cutoff
           GROUP BY day
        ),
        scored AS (
          SELECT DATE(graded_at) AS day, COUNT(*) AS graded
            FROM {_RESULTS}
           WHERE graded_at >= @cutoff
           GROUP BY day
        )
        SELECT COALESCE(u.day, s.day) AS day,
               IFNULL(u.sheets, 0)    AS sheets,
               IFNULL(u.validated, 0) AS validated,
               IFNULL(u.failed, 0)    AS failed,
               IFNULL(u.exams, 0)     AS exams,
               IFNULL(u.named, 0)     AS named,
               IFNULL(s.graded, 0)    AS graded
          FROM uploads u
          FULL OUTER JOIN scored s ON s.day = u.day
         ORDER BY day DESC
        """,
        [_p("cutoff", "TIMESTAMP", cutoff)],
    )
    return [{
        "day": r["day"].isoformat(),
        "sheets": int(r["sheets"]),
        "validated": int(r["validated"]),
        "failed": int(r["failed"]),
        "graded": int(r["graded"]),
        "exams": int(r["exams"]),
        "named": int(r["named"]),
    } for r in rows]
