"""OMR GradePro — Flask REST API.

Run with::

    pip install -r requirements.txt
    python app.py

The server listens on http://localhost:5000 and enables CORS so the Vite dev
server (http://localhost:5173) can call it directly.

A machine-readable summary of every route is served at ``GET /api`` and the
full human-readable reference lives in ``API.md``.
"""

import json
import os


def _load_dotenv(path):
    """Minimal .env loader (KEY=VALUE lines) so local config works without
    exporting variables manually. Existing environment values win."""
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# Must run before importing `auth`, which reads these vars at import time.
_load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

import db
from auth import (
    ALLOWED_DOMAINS,
    AuthError,
    admin_required,
    is_allowed_domain,
    issue_session,
    login_required,
    role_for_email,
    verify_google_token,
)
from grading import detect_answers, grade

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB, per the upload screen copy

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_BYTES

# CORS: allow all origins by default (dev), or restrict to a comma-separated
# allowlist in production via OMR_CORS_ORIGINS (e.g. "https://omr.example.com").
_cors_origins = os.environ.get("OMR_CORS_ORIGINS", "").strip()
if _cors_origins:
    CORS(app, origins=[o.strip() for o in _cors_origins.split(",") if o.strip()])
else:
    CORS(app)

os.makedirs(UPLOAD_DIR, exist_ok=True)
db.init_db()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def error(message, status=400):
    return jsonify({"error": message}), status


def _validate_answer_key(key, num_questions):
    """Coerce/validate an answer-key dict; raise ValueError on bad input."""
    if not isinstance(key, dict):
        raise ValueError("answerKey must be an object mapping question -> option")
    clean = {}
    for q, opt in key.items():
        if not str(q).isdigit() or not (1 <= int(q) <= num_questions):
            raise ValueError(f"question '{q}' out of range 1..{num_questions}")
        if opt not in ("A", "B", "C", "D"):
            raise ValueError(f"option for question '{q}' must be one of A, B, C, D")
        clean[str(int(q))] = opt
    return clean


# --------------------------------------------------------------------------- #
# API index
# --------------------------------------------------------------------------- #
@app.get("/api")
def api_index():
    """Return a machine-readable list of available endpoints."""
    return jsonify({
        "name": "OMR GradePro API",
        "version": "1.0.0",
        "endpoints": [
            {"method": "GET", "path": "/api/health", "desc": "Liveness probe"},
            {"method": "POST", "path": "/api/auth/google", "desc": "Exchange a Google ID token for a session"},
            {"method": "GET", "path": "/api/auth/me", "desc": "Return the signed-in user"},
            {"method": "POST", "path": "/api/auth/logout", "desc": "Client-side logout (stateless)"},
            {"method": "GET", "path": "/api/admin/users", "desc": "List users + allowed domains (admin)"},
            {"method": "PATCH", "path": "/api/admin/users/<id>", "desc": "Set a user's role / access (admin)"},
            {"method": "DELETE", "path": "/api/admin/users/<id>", "desc": "Delete a user (admin)"},
            {"method": "GET", "path": "/api/exams", "desc": "List exams"},
            {"method": "POST", "path": "/api/exams", "desc": "Create an exam + answer key"},
            {"method": "GET", "path": "/api/exams/<id>", "desc": "Get one exam"},
            {"method": "PUT", "path": "/api/exams/<id>", "desc": "Update an exam / answer key"},
            {"method": "DELETE", "path": "/api/exams/<id>", "desc": "Delete an exam"},
            {"method": "GET", "path": "/api/exams/<id>/sheets", "desc": "List uploaded sheets"},
            {"method": "POST", "path": "/api/exams/<id>/upload", "desc": "Upload scanned sheets (multipart)"},
            {"method": "DELETE", "path": "/api/sheets/<id>", "desc": "Remove a sheet from the queue"},
            {"method": "GET", "path": "/api/exams/<id>/validation", "desc": "Upload validation summary"},
            {"method": "POST", "path": "/api/exams/<id>/grade", "desc": "Grade all validated sheets"},
            {"method": "GET", "path": "/api/exams/<id>/results", "desc": "Results dashboard data"},
        ],
    })


@app.get("/api/health")
def health():
    """Liveness probe. Returns ``{"status": "ok"}``."""
    return jsonify({"status": "ok"})


# --------------------------------------------------------------------------- #
# Authentication (Google Identity Services)
# --------------------------------------------------------------------------- #
@app.post("/api/auth/google")
def auth_google():
    """Verify a Google ID token and return a session.

    Body: ``{ "credential": "<google-id-token>" }`` — the JWT produced by the
    GIS button in the browser. On success returns
    ``{ "token": "<session>", "user": {...} }``; ``401`` on an invalid token.
    """
    data = request.get_json(silent=True) or {}
    credential = data.get("credential")
    if not credential:
        return error("'credential' (Google ID token) is required")
    try:
        info = verify_google_token(credential)
    except AuthError as exc:
        return error(str(exc), 401)

    email = (info.get("email") or "").lower()
    if not is_allowed_domain(email):
        return error(
            "Access is restricted to " + ", ".join(sorted(ALLOWED_DOMAINS)) + " accounts.",
            403,
        )

    try:
        user = db.upsert_user(
            google_sub=info["sub"],
            email=email,
            name=info.get("name") or email,
            picture=info.get("picture"),
            role=role_for_email(email),
        )
    except Exception as exc:  # surface the real cause instead of a blank 500
        app.logger.exception("sign-in failed after token verification")
        return error(f"sign-in failed: {exc}", 500)

    if not user["active"]:
        return error("your access has been revoked; contact an administrator", 403)
    return jsonify({"token": issue_session(user), "user": user})


@app.get("/api/auth/me")
@login_required
def auth_me():
    """Return the currently signed-in user (live DB record)."""
    return jsonify(g.user)


@app.post("/api/auth/logout")
def auth_logout():
    """Stateless logout. Session tokens are self-contained, so the client
    simply discards its token; this endpoint exists for symmetry."""
    return jsonify({"status": "ok"})


# --------------------------------------------------------------------------- #
# Administration (manage who can access)
# --------------------------------------------------------------------------- #
@app.get("/api/admin/users")
@admin_required
def admin_list_users():
    """List all users with their role and access status. Admin only.
    Also returns the configured allowed email domains."""
    return jsonify({
        "users": db.list_users(),
        "allowedDomains": sorted(ALLOWED_DOMAINS),
    })


def _can_manage(actor, target):
    """Access/deletion rights: super-admins manage everyone; regular admins may
    only manage members (not other admins or super-admins)."""
    if actor["role"] == "super_admin":
        return True
    if actor["role"] == "admin":
        return target["role"] == "member"
    return False


@app.patch("/api/admin/users/<int:user_id>")
@admin_required
def admin_update_user(user_id):
    """Update a user's ``role`` (``member``|``admin``|``super_admin``) and/or
    ``active`` flag.

    Rules: only a super-admin may change roles; regular admins may only
    revoke/restore members. You cannot demote/revoke your own account, and the
    last active super-admin is protected.
    """
    data = request.get_json(silent=True) or {}
    role = data.get("role")
    active = data.get("active")

    if role is not None and role not in ("member", "admin", "super_admin"):
        return error("role must be 'member', 'admin', or 'super_admin'")
    if active is not None and not isinstance(active, bool):
        return error("active must be a boolean")

    target = db.get_user_by_id(user_id)
    if target is None:
        return error("user not found", 404)

    if role is not None and g.user["role"] != "super_admin":
        return error("only a super admin can change roles", 403)
    if not _can_manage(g.user, target):
        return error("you don't have permission to manage this user", 403)

    # Self-protection.
    if user_id == g.user["id"]:
        if active is False:
            return error("you cannot revoke your own access")
        if role is not None and role != g.user["role"]:
            return error("you cannot change your own role")

    # Never strip the last active super-admin.
    removing_super = target["role"] == "super_admin" and target["active"] and (
        (role is not None and role != "super_admin") or active is False
    )
    if removing_super and db.count_super_admins() <= 1:
        return error("cannot remove the last active super admin")

    return jsonify(db.update_user(user_id, role=role, active=active))


@app.delete("/api/admin/users/<int:user_id>")
@admin_required
def admin_delete_user(user_id):
    """Delete a user. Regular admins may only delete members; nobody can delete
    themselves or the last active super-admin."""
    target = db.get_user_by_id(user_id)
    if target is None:
        return error("user not found", 404)
    if user_id == g.user["id"]:
        return error("you cannot delete your own account")
    if not _can_manage(g.user, target):
        return error("you don't have permission to delete this user", 403)
    if target["role"] == "super_admin" and target["active"] and db.count_super_admins() <= 1:
        return error("cannot delete the last active super admin")
    db.delete_user(user_id)
    return "", 204


# --------------------------------------------------------------------------- #
# Exams + answer keys
# --------------------------------------------------------------------------- #
@app.get("/api/exams")
@login_required
def list_exams():
    """List all exams, newest first."""
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM exams ORDER BY id DESC").fetchall()
    return jsonify([db.row_to_exam(r) for r in rows])


@app.post("/api/exams")
@login_required
def create_exam():
    """Create an exam.

    Body (JSON)::

        {
          "name": "Mid-Term Physics 2024",   # required
          "date": "2024-03-14",              # optional (YYYY-MM-DD)
          "numQuestions": 50,                # 50 | 100 | 200, default 50
          "marksCorrect": 4,                 # default 4
          "marksPenalty": 1,                 # default 1
          "answerKey": {"1": "B", "2": "C"}  # optional partial/full key
        }
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return error("'name' is required")

    num_q = int(data.get("numQuestions", 50))
    try:
        key = _validate_answer_key(data.get("answerKey", {}), num_q)
    except ValueError as exc:
        return error(str(exc))

    with db.get_conn() as conn:
        row = conn.execute(
            """INSERT INTO exams (name, exam_date, num_questions, marks_correct,
                                  marks_penalty, answer_key)
               VALUES (%s, %s, %s, %s, %s, %s)
               RETURNING *""",
            (name, data.get("date"), num_q,
             float(data.get("marksCorrect", 4)), float(data.get("marksPenalty", 1)),
             json.dumps(key)),
        ).fetchone()
    return jsonify(db.row_to_exam(row)), 201


@app.get("/api/exams/<int:exam_id>")
@login_required
def get_exam(exam_id):
    """Fetch a single exam by id."""
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM exams WHERE id = %s", (exam_id,)).fetchone()
    if row is None:
        return error("exam not found", 404)
    return jsonify(db.row_to_exam(row))


@app.put("/api/exams/<int:exam_id>")
@login_required
def update_exam(exam_id):
    """Update mutable fields of an exam. Accepts the same body as create;
    every field is optional and only provided fields are changed."""
    data = request.get_json(silent=True) or {}
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM exams WHERE id = %s", (exam_id,)).fetchone()
        if row is None:
            return error("exam not found", 404)

        num_q = int(data.get("numQuestions", row["num_questions"]))
        try:
            key = (_validate_answer_key(data["answerKey"], num_q)
                   if "answerKey" in data else json.loads(row["answer_key"]))
        except ValueError as exc:
            return error(str(exc))

        row = conn.execute(
            """UPDATE exams SET name = %s, exam_date = %s, num_questions = %s,
                   marks_correct = %s, marks_penalty = %s, answer_key = %s
               WHERE id = %s
               RETURNING *""",
            (data.get("name", row["name"]),
             data.get("date", row["exam_date"]),
             num_q,
             float(data.get("marksCorrect", row["marks_correct"])),
             float(data.get("marksPenalty", row["marks_penalty"])),
             json.dumps(key),
             exam_id),
        ).fetchone()
    return jsonify(db.row_to_exam(row))


@app.delete("/api/exams/<int:exam_id>")
@login_required
def delete_exam(exam_id):
    """Delete an exam and cascade-remove its sheets and results."""
    with db.get_conn() as conn:
        cur = conn.execute("DELETE FROM exams WHERE id = %s", (exam_id,))
    if cur.rowcount == 0:
        return error("exam not found", 404)
    return "", 204


# --------------------------------------------------------------------------- #
# Uploads
# --------------------------------------------------------------------------- #
@app.get("/api/exams/<int:exam_id>/sheets")
@login_required
def list_sheets(exam_id):
    """List every uploaded sheet for an exam (the upload queue)."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM sheets WHERE exam_id = %s ORDER BY id DESC", (exam_id,)
        ).fetchall()
    return jsonify([db.row_to_sheet(r) for r in rows])


@app.post("/api/exams/<int:exam_id>/upload")
@login_required
def upload_sheets(exam_id):
    """Upload one or more scanned answer sheets (``multipart/form-data``).

    Send files under the form field ``files``. Each file is validated by
    extension (pdf/jpg/jpeg/png). Recognised files are stored, run through the
    (stubbed) mark detector, and marked ``validated``; unrecognised files are
    recorded with status ``failed``. Returns the created sheet records.
    """
    with db.get_conn() as conn:
        exam = conn.execute("SELECT * FROM exams WHERE id = %s", (exam_id,)).fetchone()
    if exam is None:
        return error("exam not found", 404)

    files = request.files.getlist("files")
    if not files:
        return error("no files provided under form field 'files'")

    created = []
    with db.get_conn() as conn:
        for f in files:
            fname = secure_filename(f.filename or "unnamed")
            ext = os.path.splitext(fname)[1].lower()
            blob = f.read()
            size = len(blob)

            if ext not in ALLOWED_EXT:
                row = conn.execute(
                    """INSERT INTO sheets (exam_id, filename, size_bytes, status, error)
                       VALUES (%s, %s, %s, 'failed', 'Unrecognized format')
                       RETURNING *""",
                    (exam_id, fname, size),
                ).fetchone()
            else:
                path = os.path.join(UPLOAD_DIR, f"{exam_id}_{fname}")
                with open(path, "wb") as out:
                    out.write(blob)
                answers = detect_answers(fname, exam["num_questions"])
                roll = f"R{1000 + (abs(hash(fname)) % 9000)}"
                row = conn.execute(
                    """INSERT INTO sheets (exam_id, filename, size_bytes, status,
                                           roll_number, answers)
                       VALUES (%s, %s, %s, 'validated', %s, %s)
                       RETURNING *""",
                    (exam_id, fname, size, roll, json.dumps(answers)),
                ).fetchone()
            created.append(db.row_to_sheet(row))
    return jsonify(created), 201


@app.delete("/api/sheets/<int:sheet_id>")
@login_required
def delete_sheet(sheet_id):
    """Remove a single sheet from the queue (and its result, if graded)."""
    with db.get_conn() as conn:
        cur = conn.execute("DELETE FROM sheets WHERE id = %s", (sheet_id,))
    if cur.rowcount == 0:
        return error("sheet not found", 404)
    return "", 204


@app.get("/api/exams/<int:exam_id>/validation")
@login_required
def validation_summary(exam_id):
    """Return the upload-screen validation summary for an exam::

        {
          "totalDetected": 51,
          "readyForGrading": 50,
          "issues": 1,
          "issueDetails": ["Roll number missing on 1 sheet."]
        }
    """
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM sheets WHERE exam_id = %s", (exam_id,)
        ).fetchall()

    total = len(rows)
    ready = sum(1 for r in rows if r["status"] == "validated" and r["roll_number"])
    failed = [r for r in rows if r["status"] == "failed"]
    missing_roll = [r for r in rows if r["status"] == "validated" and not r["roll_number"]]

    details = []
    if failed:
        details.append(f"{len(failed)} sheet(s) could not be read.")
    if missing_roll:
        details.append(f"Roll number missing on {len(missing_roll)} sheet(s).")

    return jsonify({
        "totalDetected": total,
        "readyForGrading": ready,
        "issues": len(failed) + len(missing_roll),
        "issueDetails": details,
    })


# --------------------------------------------------------------------------- #
# Grading + results
# --------------------------------------------------------------------------- #
@app.post("/api/exams/<int:exam_id>/grade")
@login_required
def grade_exam(exam_id):
    """Grade every ``validated`` sheet against the exam answer key.

    Requires a non-empty answer key. Idempotent: existing results are replaced.
    Returns ``{"graded": <n>}``.
    """
    with db.get_conn() as conn:
        exam = conn.execute("SELECT * FROM exams WHERE id = %s", (exam_id,)).fetchone()
        if exam is None:
            return error("exam not found", 404)

        answer_key = json.loads(exam["answer_key"])
        if not answer_key:
            return error("answer key is empty; configure it before grading")

        sheets = conn.execute(
            "SELECT * FROM sheets WHERE exam_id = %s AND status = 'validated'", (exam_id,)
        ).fetchall()

        graded = 0
        for s in sheets:
            res = grade(answer_key, json.loads(s["answers"]),
                        exam["marks_correct"], exam["marks_penalty"])
            conn.execute("DELETE FROM results WHERE sheet_id = %s", (s["id"],))
            conn.execute(
                """INSERT INTO results (sheet_id, exam_id, correct, wrong,
                                        unattempted, score, max_score)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (s["id"], exam_id, res["correct"], res["wrong"],
                 res["unattempted"], res["score"], res["maxScore"]),
            )
            graded += 1
    return jsonify({"graded": graded})


@app.get("/api/exams/<int:exam_id>/results")
@login_required
def results(exam_id):
    """Return the results dashboard payload for an exam::

        {
          "exam": {...},
          "stats": {"graded": 50, "average": 132.5, "highest": 196,
                     "lowest": 40, "passRate": 0.72},
          "rows": [{"sheetId": 1, "rollNumber": "R1234",
                     "correct": 40, "wrong": 8, "unattempted": 2,
                     "score": 152, "maxScore": 200}, ...]
        }

    ``passRate`` uses a 40% threshold of ``maxScore``.
    """
    with db.get_conn() as conn:
        exam = conn.execute("SELECT * FROM exams WHERE id = %s", (exam_id,)).fetchone()
        if exam is None:
            return error("exam not found", 404)
        rows = conn.execute(
            """SELECT r.*, s.roll_number, s.student_name, s.filename
                 FROM results r JOIN sheets s ON s.id = r.sheet_id
                WHERE r.exam_id = %s ORDER BY r.score DESC""",
            (exam_id,),
        ).fetchall()

    result_rows = [{
        "sheetId": r["sheet_id"],
        "rollNumber": r["roll_number"],
        "studentName": r["student_name"],
        "filename": r["filename"],
        "correct": r["correct"],
        "wrong": r["wrong"],
        "unattempted": r["unattempted"],
        "score": r["score"],
        "maxScore": r["max_score"],
    } for r in rows]

    scores = [r["score"] for r in rows]
    max_score = rows[0]["max_score"] if rows else 0
    passing = sum(1 for s in scores if max_score and s >= 0.4 * max_score)
    stats = {
        "graded": len(scores),
        "average": round(sum(scores) / len(scores), 2) if scores else 0,
        "highest": max(scores) if scores else 0,
        "lowest": min(scores) if scores else 0,
        "passRate": round(passing / len(scores), 3) if scores else 0,
    }

    return jsonify({"exam": db.row_to_exam(exam), "stats": stats, "rows": result_rows})


if __name__ == "__main__":
    # Deployment-configurable. Bind 0.0.0.0 in containers so the port is
    # reachable; PORT is the convention used by most PaaS providers.
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes", "on")
    app.run(host=host, port=port, debug=debug)
