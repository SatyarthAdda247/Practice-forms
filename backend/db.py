"""Persistence layer for OMR GradePro (BigQuery-only).

Everything lives in BigQuery now:

  * **Users** live in the shared ``Aspirant_portal`` dataset — see
    :mod:`bigquery_users`. Those functions are re-exported here so callers can
    keep using ``db.get_user_by_id`` etc. (currently stubbed while login is off).
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
from datetime import datetime, timezone

# --- TEMPORARY: BigQuery user imports stubbed out (login is disabled) ---
# Original imports:
# from bigquery_users import (  # noqa: F401
#     count_super_admins,
#     create_local_user,
#     delete_user,
#     get_user_by_id,
#     get_user_row_by_email,
#     list_users,
#     row_to_user,
#     update_user,
#     upsert_user,
# )
# from bigquery_users import init as _init_users

# Stub user functions (unused while login is disabled)
def get_user_by_id(user_id):
    return None

def upsert_user(**kwargs):
    return None

def list_users():
    return []

def update_user(user_id, **kwargs):
    return None

def delete_user(user_id):
    return False

def count_super_admins():
    return 1

def get_user_row_by_email(email):
    return None

def create_local_user(email, name, password_hash):
    return None

def row_to_user(row):
    return None

def _init_users():
    pass
# --- END TEMPORARY user stubs ---


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
PROJECT = os.environ.get("BQ_PROJECT", "adda247-dev")
DATASET = os.environ.get("BQ_DATASET", "Aspirant_portal")
EXAMS_TABLE = os.environ.get("BQ_EXAMS_TABLE", "omr_exams")
SHEETS_TABLE = os.environ.get("BQ_SHEETS_TABLE", "omr_sheets")
RESULTS_TABLE = os.environ.get("BQ_RESULTS_TABLE", "omr_results")

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
    of ``Row`` objects (empty for pure DML)."""
    from google.cloud import bigquery
    job = _client().query(
        sql, job_config=bigquery.QueryJobConfig(query_parameters=params or [])
    )
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
    """Return ``(table_id, schema_fields, clustering_fields)`` for each
    app-owned table, using the BigQuery SDK types (built lazily so importing
    this module never requires the SDK)."""
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
        ], ["id"]),
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
        ], ["exam_id", "id"]),
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
        ], ["exam_id", "sheet_id"]),
    )


def init_db():
    """Ensure the exams/sheets/results tables exist in BigQuery (idempotent).

    Uses the metadata API (``create_table(..., exists_ok=True)``) so it does not
    need ``bigquery.jobs.create``. BigQuery user init is temporarily stubbed out
    while login is disabled."""
    from google.cloud import bigquery
    _init_users()  # TEMPORARY: no-op stub
    client = _client()
    for table_id, schema, clustering in _table_specs():
        table = bigquery.Table(table_id, schema=schema)
        table.clustering_fields = clustering
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
def list_exams():
    """All exams as physical-column dicts, newest first."""
    _, rows = _execute(
        f"SELECT id, name, exam_date, num_questions, marks_correct, "
        f"marks_penalty, answer_key, created_at FROM {_EXAMS} ORDER BY id DESC"
    )
    return [dict(r) for r in rows]


def get_exam(exam_id):
    """A single exam as a physical-column dict, or ``None``."""
    _, rows = _execute(
        f"SELECT id, name, exam_date, num_questions, marks_correct, "
        f"marks_penalty, answer_key, created_at FROM {_EXAMS} "
        f"WHERE id = @id LIMIT 1",
        [_p("id", "INT64", exam_id)],
    )
    return dict(rows[0]) if rows else None


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
    return bool(job.num_dml_affected_rows)


# --------------------------------------------------------------------------- #
# Sheets
# --------------------------------------------------------------------------- #
def list_sheets(exam_id):
    """All sheets for an exam as physical-column dicts, newest first."""
    _, rows = _execute(
        f"SELECT id, exam_id, filename, size_bytes, status, error, "
        f"roll_number, student_name, answers, flags, created_at FROM {_SHEETS} "
        f"WHERE exam_id = @exam_id ORDER BY id DESC",
        [_p("exam_id", "INT64", exam_id)],
    )
    return [dict(r) for r in rows]


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


def delete_sheet(sheet_id):
    """Delete a sheet and its result (no FKs in BigQuery). Returns ``True`` if
    the sheet existed."""
    _execute(f"DELETE FROM {_RESULTS} WHERE sheet_id = @id",
             [_p("id", "INT64", sheet_id)])
    job, _ = _execute(f"DELETE FROM {_SHEETS} WHERE id = @id",
                      [_p("id", "INT64", sheet_id)])
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
    return len(results)


def list_results(exam_id):
    """Results joined with their sheet metadata, highest score first. Returns
    dicts with keys: ``sheet_id``, ``roll_number``, ``student_name``,
    ``filename``, ``flags``, ``correct``, ``wrong``, ``unattempted``,
    ``score``, ``max_score``."""
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
