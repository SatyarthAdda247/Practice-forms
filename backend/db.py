"""Persistence layer for OMR GradePro (hybrid).

  * **Users** live in BigQuery (shared ``Aspirant_portal`` dataset) — see
    :mod:`bigquery_users`. Those functions are re-exported here so callers can
    keep using ``db.get_user_by_id`` etc.
  * **Exams / sheets / results** live in Cloud SQL (Postgres), accessed via
    ``psycopg`` (v3). Connection string comes from ``DATABASE_URL``.

Placeholders are ``%s`` (Postgres/psycopg), and new-row ids are returned with
``RETURNING`` — mind this if you add SQL in ``app.py``.
"""

import json
import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

# Re-export the BigQuery-backed user repository under the db.* namespace so the
# rest of the app does not need to know where users are stored.
from bigquery_users import (  # noqa: F401
    count_super_admins,
    create_local_user,
    delete_user,
    get_user_by_id,
    get_user_row_by_email,
    list_users,
    row_to_user,
    update_user,
    upsert_user,
)
from bigquery_users import init as _init_users

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# DDL for the transactional tables (Postgres). Users are intentionally NOT here.
_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS exams (
        id            BIGSERIAL PRIMARY KEY,
        name          TEXT    NOT NULL,
        exam_date     TEXT,
        num_questions INTEGER NOT NULL DEFAULT 50,
        marks_correct REAL    NOT NULL DEFAULT 4,
        marks_penalty REAL    NOT NULL DEFAULT 1,
        answer_key    TEXT    NOT NULL DEFAULT '{}',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sheets (
        id           BIGSERIAL PRIMARY KEY,
        exam_id      BIGINT  NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        filename     TEXT    NOT NULL,
        size_bytes   BIGINT  NOT NULL DEFAULT 0,
        status       TEXT    NOT NULL DEFAULT 'processing',
        error        TEXT,
        roll_number  TEXT,
        student_name TEXT,
        answers      TEXT    NOT NULL DEFAULT '{}',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS results (
        id           BIGSERIAL PRIMARY KEY,
        sheet_id     BIGINT  NOT NULL UNIQUE REFERENCES sheets(id) ON DELETE CASCADE,
        exam_id      BIGINT  NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        correct      INTEGER NOT NULL DEFAULT 0,
        wrong        INTEGER NOT NULL DEFAULT 0,
        unattempted  INTEGER NOT NULL DEFAULT 0,
        score        REAL    NOT NULL DEFAULT 0,
        max_score    REAL    NOT NULL DEFAULT 0,
        graded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
)


@contextmanager
def get_conn():
    """Yield a Postgres connection with dict rows; commit on clean exit."""
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set — it must point at the Cloud SQL Postgres "
            "instance holding exams/sheets/results."
        )
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create the transactional tables (idempotent) and verify BigQuery users
    are reachable. Postgres enforces the foreign keys/cascades declared above."""
    _init_users()  # metadata check only — no row scan
    with get_conn() as conn:
        for ddl in _SCHEMA:
            conn.execute(ddl)


# --------------------------------------------------------------------------- #
# Serialisation for the transactional tables
# --------------------------------------------------------------------------- #
def _ts(value):
    """Render a timestamp column as an ISO string (parity with the old text
    ``datetime('now')`` values)."""
    return value.isoformat() if hasattr(value, "isoformat") else value


def row_to_exam(row):
    """Serialise an ``exams`` row to a JSON-friendly dict."""
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
    """Serialise a ``sheets`` row to a JSON-friendly dict."""
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
        "createdAt": _ts(row["created_at"]),
    }
