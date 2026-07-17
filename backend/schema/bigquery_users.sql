-- OMR GradePro / Aspirant Portal — BigQuery users table.
-- Users are the source of truth in BigQuery (see bigquery_users.py); the
-- transactional tables (exams/sheets/results) live in Cloud SQL — see postgres.sql.
--
-- Column names and types mirror bigquery_users.COLS and the INSERT/MERGE
-- statements in that module. `id` is STRING because BQ_USERS_ID_MODE defaults
-- to 'uuid'; if you set BQ_USERS_ID_MODE=int, change `id` to INT64.
--
-- Run this in the BigQuery console Query editor (or `bq query --use_legacy_sql=false`).
-- CREATE OR REPLACE is safe on an empty table; it will DROP existing data.

CREATE OR REPLACE TABLE `adda247-dev.Aspirant_portal.users` (
  id            STRING    NOT NULL,               -- primary key (UUID); INT64 if ID_MODE=int
  google_sub    STRING,                           -- Google account subject; NULL for email/password users
  email         STRING    NOT NULL,
  name          STRING,
  picture       STRING,                           -- avatar URL; NULL for email/password users
  password_hash STRING,                           -- only set for email/password users
  role          STRING,                           -- 'member' | 'admin' | 'super_admin'
  active        BOOL,
  created_at    TIMESTAMP
);
