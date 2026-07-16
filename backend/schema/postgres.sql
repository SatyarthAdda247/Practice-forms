-- OMR GradePro — Cloud SQL (Postgres) schema for the transactional tables.
-- Users are NOT here: they live in BigQuery (adda247-dev.Aspirant_portal).
-- app.py / db.init_db() also creates these on startup (idempotent); this file
-- is for DBAs/DevOps who prefer to provision the schema up front.

CREATE TABLE IF NOT EXISTS exams (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT    NOT NULL,
    exam_date     TEXT,
    num_questions INTEGER NOT NULL DEFAULT 50,
    marks_correct REAL    NOT NULL DEFAULT 4,
    marks_penalty REAL    NOT NULL DEFAULT 1,
    answer_key    TEXT    NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sheets (
    id           BIGSERIAL PRIMARY KEY,
    exam_id      BIGINT  NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    filename     TEXT    NOT NULL,
    size_bytes   BIGINT  NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'processing',  -- processing|validated|failed
    error        TEXT,
    roll_number  TEXT,
    student_name TEXT,
    answers      TEXT    NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheets_exam_id ON sheets(exam_id);

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
);
CREATE INDEX IF NOT EXISTS idx_results_exam_id ON results(exam_id);
