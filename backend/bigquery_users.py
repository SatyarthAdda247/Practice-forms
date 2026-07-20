"""BigQuery-backed user repository (user management).

Users are the source of truth in the shared BigQuery table
``adda247-dev.Aspirant_portal.<users>``. BigQuery is an analytics warehouse,
not an OLTP database, so this module is written deliberately to be safe and
cheap for transactional-style access:

  * **DML only** (``INSERT`` / ``MERGE`` / ``UPDATE`` / ``DELETE``) — never the
    streaming API. Streamed rows sit in a buffer and cannot be UPDATE/DELETEd
    for up to ~90 minutes, which would break sign-in and admin edits.
  * **Never ``SELECT *``** and always filter by key, so the smallest possible
    set of columns is read.
  * **Short-TTL cache** for point lookups so ``/auth/me`` on every request does
    not issue a fresh (billed) query each time.

Configuration (environment variables)::

    BQ_PROJECT                     default 'adda247-dev'
    BQ_DATASET                     default 'Aspirant_portal'
    BQ_USERS_TABLE                 default 'users'
    BQ_USERS_ID_MODE               'uuid' (default) | 'int'
    BQ_USER_CACHE_TTL              point-lookup cache seconds (default 30, 0=off)
    GOOGLE_APPLICATION_CREDENTIALS path to the service-account JSON key

.. IMPORTANT::
   The column names below are ASSUMED to mirror the previous SQLite schema
   (id, google_sub, email, name, picture, password_hash, role, active,
   created_at). If your existing table differs, adjust :data:`COLS` and
   :data:`ID_MODE` — nothing else needs to change. `id` defaults to a STRING
   UUID; set ``BQ_USERS_ID_MODE=int`` only if your ``id`` column is INT64.
"""

import os
import time
import uuid

PROJECT = os.environ.get("BQ_PROJECT", "adda247-dev")
DATASET = os.environ.get("BQ_DATASET", "Aspirant_portal")
TABLE = os.environ.get("BQ_USERS_TABLE", "users")
ID_MODE = os.environ.get("BQ_USERS_ID_MODE", "uuid").lower()
CACHE_TTL = int(os.environ.get("BQ_USER_CACHE_TTL", "30"))

# Logical column -> physical column name in the BigQuery table. Change the
# right-hand side here if your table uses different names.
COLS = {
    "id": "id",
    "google_sub": "google_sub",
    "email": "email",
    "name": "name",
    "picture": "picture",
    "password_hash": "password_hash",
    "role": "role",
    "active": "active",
    "created_at": "created_at",
}

_FQN = f"`{PROJECT}.{DATASET}.{TABLE}`"
_client_singleton = None

# Tiny in-process TTL cache for id -> user, so the per-request auth lookup does
# not hit BigQuery every time. Invalidated on any write.
_cache = {}


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
    """Run a query/DML statement. Returns (job, rows). ``rows`` is a list of
    BigQuery ``Row`` objects (empty for pure DML); DML row counts are on
    ``job.num_dml_affected_rows``."""
    from google.cloud import bigquery
    job = _client().query(
        sql, job_config=bigquery.QueryJobConfig(query_parameters=params or [])
    )
    rows = list(job.result())
    return job, rows


def _id_type():
    return "INT64" if ID_MODE == "int" else "STRING"


def _new_id():
    """Generate a fresh primary key. UUID mode is scan-free; INT mode reads the
    max id (a one-column scan) and is inherently racy — prefer UUID."""
    if ID_MODE == "int":
        _, rows = _execute(
            f"SELECT IFNULL(MAX({COLS['id']}), 0) + 1 AS n FROM {_FQN}"
        )
        return int(rows[0]["n"]) if rows else 1
    return str(uuid.uuid4())


def _select_cols():
    c = COLS
    return (f"{c['id']} AS id, {c['google_sub']} AS google_sub, "
            f"{c['email']} AS email, {c['name']} AS name, "
            f"{c['picture']} AS picture, {c['role']} AS role, "
            f"{c['active']} AS active, {c['created_at']} AS created_at")


def _invalidate(user_id=None):
    if user_id is None:
        _cache.clear()
    else:
        _cache.pop(user_id, None)


# --------------------------------------------------------------------------- #
# Serialisation
# --------------------------------------------------------------------------- #
def row_to_user(row):
    """Serialise a BigQuery row (or dict) to the app's user dict. Never exposes
    the password hash."""
    if row is None:
        return None
    get = row.get if hasattr(row, "get") else row.__getitem__
    created = get("created_at")
    return {
        "id": get("id"),
        "email": get("email"),
        "name": get("name"),
        "picture": get("picture"),
        "role": get("role") or "member",
        "active": bool(get("active")) if get("active") is not None else True,
        "createdAt": created.isoformat() if hasattr(created, "isoformat") else created,
    }


# --------------------------------------------------------------------------- #
# Public API (mirrors the previous SQLite db.py user functions)
# --------------------------------------------------------------------------- #
def _schema():
    """SchemaField list for the users table (all NULLABLE so the columns can be
    added to a pre-existing/empty table in place)."""
    from google.cloud import bigquery
    F = bigquery.SchemaField
    c = COLS
    return [
        F(c["id"], _id_type()),
        F(c["google_sub"], "STRING"),
        F(c["email"], "STRING"),
        F(c["name"], "STRING"),
        F(c["picture"], "STRING"),
        F(c["password_hash"], "STRING"),
        F(c["role"], "STRING"),
        F(c["active"], "BOOL"),
        F(c["created_at"], "TIMESTAMP"),
    ]


def init():
    """Ensure the users table exists **with a schema** (idempotent, additive).

    Uses the metadata API only (``create_table``/``update_table`` — needs
    ``tables.create``/``tables.update``, not ``jobs.create``). Handles the case
    where the table pre-exists but has no/partial schema (BigQuery then errors
    "Table ... does not have a schema" on every query): the missing NULLABLE
    columns are added in place. Never drops or retypes existing columns."""
    from google.cloud import bigquery
    client = _client()
    table_id = f"{PROJECT}.{DATASET}.{TABLE}"
    schema = _schema()
    try:
        table = client.create_table(
            bigquery.Table(table_id, schema=schema), exists_ok=True
        )
        have = {f.name for f in table.schema}
        missing = [f for f in schema if f.name not in have]
        if missing:
            table.schema = list(table.schema) + missing
            client.update_table(table, ["schema"])
    except Exception as exc:  # noqa: BLE001 — surface a clear config error
        raise RuntimeError(
            f"Cannot provision BigQuery users table {table_id}: {exc}. "
            "Check GOOGLE_APPLICATION_CREDENTIALS and BQ_* env vars."
        ) from exc


def get_user_by_id(user_id):
    """Return a user dict by id (short-TTL cached), or ``None``."""
    if CACHE_TTL:
        hit = _cache.get(user_id)
        if hit and hit[0] > time.time():
            return hit[1]
    _, rows = _execute(
        f"SELECT {_select_cols()} FROM {_FQN} WHERE {COLS['id']} = @id LIMIT 1",
        [_p("id", _id_type(), user_id)],
    )
    user = row_to_user(rows[0]) if rows else None
    if CACHE_TTL and user is not None:
        _cache[user_id] = (time.time() + CACHE_TTL, user)
    return user


def get_user_by_google_sub(google_sub):
    _, rows = _execute(
        f"SELECT {_select_cols()} FROM {_FQN} WHERE {COLS['google_sub']} = @sub LIMIT 1",
        [_p("sub", "STRING", google_sub)],
    )
    return row_to_user(rows[0]) if rows else None


def get_user_by_email(email):
    """Return a user dict by email (case-insensitive), or ``None``."""
    _, rows = _execute(
        f"SELECT {_select_cols()} FROM {_FQN} "
        f"WHERE LOWER({COLS['email']}) = @email LIMIT 1",
        [_p("email", "STRING", (email or "").lower())],
    )
    return row_to_user(rows[0]) if rows else None


def create_user(email, name, role="member"):
    """Pre-authorise ("invite") a user by email with a role, before they have
    signed in — so ``google_sub`` is left NULL and linked on their first login
    (see :func:`upsert_user`). Returns the created dict; raises ``ValueError``
    if a user with that email already exists."""
    if get_user_by_email(email) is not None:
        raise ValueError("a user with that email already exists")
    c = COLS
    new_id = _new_id()
    _execute(
        f"""INSERT INTO {_FQN}
            ({c['id']}, {c['email']}, {c['name']}, {c['role']}, {c['active']},
             {c['created_at']})
            VALUES (@id, @email, @name, @role, TRUE, CURRENT_TIMESTAMP())""",
        [
            _p("id", _id_type(), new_id),
            _p("email", "STRING", email),
            _p("name", "STRING", name or email),
            _p("role", "STRING", role),
        ],
    )
    _invalidate(new_id)
    return get_user_by_id(new_id)


def upsert_user(google_sub, email, name, picture, role="member"):
    """Insert or update a user keyed by Google subject id (MERGE / DML).

    Profile fields refresh on update; ``active`` is preserved; ``role`` is only
    ever promoted (bootstrap admins/super-admins are never demoted by a normal
    login) — same semantics as the old SQLite ``ON CONFLICT`` path."""
    c = COLS
    existing = get_user_by_google_sub(google_sub)

    # No account for this Google identity yet: if an admin pre-authorised this
    # email (an invite whose google_sub is still NULL), link the identity to
    # that row instead of creating a duplicate — preserving the granted role.
    if existing is None:
        _, pending = _execute(
            f"SELECT {_select_cols()} FROM {_FQN} "
            f"WHERE LOWER({c['email']}) = @email AND {c['google_sub']} IS NULL LIMIT 1",
            [_p("email", "STRING", (email or "").lower())],
        )
        if pending:
            uid = pending[0]["id"]
            _execute(
                f"""UPDATE {_FQN} SET
                    {c['google_sub']} = @sub, {c['name']} = @name,
                    {c['picture']} = @picture,
                    {c['role']} = CASE
                      WHEN @role = 'super_admin' OR {c['role']} = 'super_admin' THEN 'super_admin'
                      WHEN @role = 'admin' OR {c['role']} = 'admin' THEN 'admin'
                      ELSE {c['role']} END
                    WHERE {c['id']} = @id AND {c['google_sub']} IS NULL""",
                [
                    _p("sub", "STRING", google_sub),
                    _p("name", "STRING", name),
                    _p("picture", "STRING", picture),
                    _p("role", "STRING", role),
                    _p("id", _id_type(), uid),
                ],
            )
            _invalidate(uid)
            return get_user_by_id(uid)

    # Only pay for id generation when the user might be new. MERGE needs the id
    # value bound regardless; it is ignored on the MATCHED branch.
    new_id = existing["id"] if existing else _new_id()

    sql = f"""
    MERGE {_FQN} T
    USING (
      SELECT @google_sub AS google_sub, @email AS email, @name AS name,
             @picture AS picture, @role AS role
    ) S
    ON T.{c['google_sub']} = S.google_sub
    WHEN MATCHED THEN UPDATE SET
      {c['email']} = S.email,
      {c['name']} = S.name,
      {c['picture']} = S.picture,
      {c['role']} = CASE
        WHEN S.role = 'super_admin' OR T.{c['role']} = 'super_admin' THEN 'super_admin'
        WHEN S.role = 'admin' OR T.{c['role']} = 'admin' THEN 'admin'
        ELSE T.{c['role']} END
    WHEN NOT MATCHED THEN INSERT
      ({c['id']}, {c['google_sub']}, {c['email']}, {c['name']}, {c['picture']},
       {c['role']}, {c['active']}, {c['created_at']})
      VALUES (@id, S.google_sub, S.email, S.name, S.picture, S.role, TRUE,
              CURRENT_TIMESTAMP())
    """
    _execute(sql, [
        _p("id", _id_type(), new_id),
        _p("google_sub", "STRING", google_sub),
        _p("email", "STRING", email),
        _p("name", "STRING", name),
        _p("picture", "STRING", picture),
        _p("role", "STRING", role),
    ])
    _invalidate(new_id)
    return get_user_by_google_sub(google_sub)


def list_users(limit=1000):
    """Return users for the admin console (admins first, then newest). Scans the
    table (admin-only, infrequent); bounded by ``limit``."""
    c = COLS
    _, rows = _execute(
        f"""SELECT {_select_cols()} FROM {_FQN}
            ORDER BY ({c['role']} = 'admin') DESC, {c['created_at']} DESC
            LIMIT {int(limit)}"""
    )
    return [row_to_user(r) for r in rows]


def update_user(user_id, role=None, active=None):
    """Patch a user's ``role`` and/or ``active`` flag; return the updated dict
    or ``None`` if the user does not exist."""
    current = get_user_by_id(user_id)
    if current is None:
        return None
    new_role = role if role is not None else current["role"]
    new_active = active if active is not None else current["active"]
    _execute(
        f"""UPDATE {_FQN}
            SET {COLS['role']} = @role, {COLS['active']} = @active
            WHERE {COLS['id']} = @id""",
        [
            _p("role", "STRING", new_role),
            _p("active", "BOOL", bool(new_active)),
            _p("id", _id_type(), user_id),
        ],
    )
    _invalidate(user_id)
    return get_user_by_id(user_id)


def delete_user(user_id):
    """Delete a user by id. Returns True if a row was removed."""
    job, _ = _execute(
        f"DELETE FROM {_FQN} WHERE {COLS['id']} = @id",
        [_p("id", _id_type(), user_id)],
    )
    _invalidate(user_id)
    return (job.num_dml_affected_rows or 0) > 0


def count_super_admins():
    """Number of active super-admins (prevents locking out the last one)."""
    _, rows = _execute(
        f"""SELECT COUNT(*) AS n FROM {_FQN}
            WHERE {COLS['role']} = 'super_admin' AND {COLS['active']} = TRUE"""
    )
    return int(rows[0]["n"]) if rows else 0


def get_user_row_by_email(email):
    """Return the user row (including password hash) by email, or ``None``.
    Used only by the (currently unwired) email/password path."""
    c = COLS
    _, rows = _execute(
        f"""SELECT {_select_cols()}, {c['password_hash']} AS password_hash
            FROM {_FQN} WHERE {c['email']} = @email LIMIT 1""",
        [_p("email", "STRING", email)],
    )
    return rows[0] if rows else None


def create_local_user(email, name, password_hash):
    """Create an email/password user (DML insert), returning the dict."""
    c = COLS
    new_id = _new_id()
    _execute(
        f"""INSERT INTO {_FQN}
            ({c['id']}, {c['email']}, {c['name']}, {c['password_hash']},
             {c['role']}, {c['active']}, {c['created_at']})
            VALUES (@id, @email, @name, @pw, 'member', TRUE, CURRENT_TIMESTAMP())""",
        [
            _p("id", _id_type(), new_id),
            _p("email", "STRING", email),
            _p("name", "STRING", name),
            _p("pw", "STRING", password_hash),
        ],
    )
    return get_user_by_id(new_id)
