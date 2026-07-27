"""OMR GradePro — Flask REST API.

Run with::

    pip install -r requirements.txt
    python app.py

The server listens on http://localhost:5000 and enables CORS so the Vite dev
server (http://localhost:5173) can call it directly.

A machine-readable summary of every route is served at ``GET /api`` and the
full human-readable reference lives in ``API.md``.
"""

import io
import json
import os
import re
import tempfile


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


def _resolve_credentials():
    """Make GOOGLE_APPLICATION_CREDENTIALS work regardless of how the SA key is
    supplied.

    Two supported forms:

    1. ``GOOGLE_APPLICATION_CREDENTIALS_JSON`` — the full service-account key
       JSON provided inline as an env var. This is the right choice when the
       platform only injects env vars (no mounted key file, no Kubernetes
       Secret): we materialize it to a temp file and point the standard var at
       it. Put the key minified onto a single line in your config file.

    2. ``GOOGLE_APPLICATION_CREDENTIALS`` — a path to a key file. The Google
       auth library resolves a relative path against the current working
       directory; anchor a relative value to this file's directory so the SA
       key is found whether the server is started from ``backend/`` or the repo
       root."""
    inline = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "").strip()
    if inline:
        key_path = os.path.join(tempfile.gettempdir(), "gcp-sa-key.json")
        with open(key_path, "w") as fh:
            fh.write(inline)
        os.chmod(key_path, 0o600)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path
        return

    cred = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if cred and not os.path.isabs(cred):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(
            os.path.dirname(__file__), cred
        )


_resolve_credentials()

from flask import Flask, Response, g, jsonify, request
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
import omr_pipeline
import tools_store
from grading import grade

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB, per the upload screen copy
# Fall back to OCR (local TrOCR) for the handwritten name when the sheet's A-Z
# bubble grid is blank. Best-effort and never fatal. Off with OMR_NAME_OCR=0.
# See name_trocr: it only reads a blue-pen "NAME- <name>" line, never the
# printed per-character boxes, which no OCR engine reads reliably.
NAME_OCR = os.environ.get("OMR_NAME_OCR", "1") != "0"

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
# Provisions the two public-tool tables. Never raises — a problem there must
# not stop the portal API from booting (see tools_store.init).
tools_store.init()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def error(message, status=400):
    return jsonify({"error": message}), status


def _pdf_page_count(blob):
    """Return the number of pages in a PDF blob, or 1 if it can't be parsed.

    A batch scan often packs one student's OMR sheet per page, so the page
    count is how many sheets a single uploaded PDF actually contains."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(blob))
        return max(1, len(reader.pages))
    except Exception:
        # Corrupt/unreadable PDF: fall back to treating it as a single sheet.
        return 1


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
            {"method": "POST", "path": "/api/admin/users", "desc": "Pre-authorise a user by email (admin)"},
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
            {"method": "POST", "path": "/api/tools/image-resizer/leads", "desc": "Log an image-resizer download + lead (public)"},
            {"method": "POST", "path": "/api/tools/answerkey-checker/results", "desc": "Log an answer-key analysis (public)"},
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

    Access is **invitation-only**: the email must be on an allowed domain AND
    already added by an admin (or a bootstrap admin from env). Otherwise ``403``.
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

    # Invitation-only: an allowed-domain account is NOT enough — the user must
    # have been added by an admin (a row already exists for their email, whether
    # a linked account or a pending invite) unless they are a bootstrap admin
    # configured via env. This stops any allowed-domain user self-registering.
    if role_for_email(email) == "member" and db.get_user_by_email(email) is None:
        return error(
            "Your account hasn't been granted access yet. "
            "Please ask an administrator to add you.",
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


@app.post("/api/admin/users")
@admin_required
def admin_create_user():
    """Pre-authorise a user by email so they can sign in with the given role.

    Body: ``{ "email": "...", "role": "member|admin|super_admin", "name": "?" }``.
    The email must be on an allowed domain. **Super-admins only.** The Google
    identity links to this record on the user's first sign-in.
    """
    if g.user["role"] != "super_admin":
        return error("only a super admin can add users", 403)

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    role = data.get("role") or "member"
    name = (data.get("name") or "").strip() or email.split("@")[0]

    if not email or "@" not in email:
        return error("a valid email is required")
    if not is_allowed_domain(email):
        return error(
            "email must be on an allowed domain: " + ", ".join(sorted(ALLOWED_DOMAINS))
        )
    if role not in ("member", "admin", "super_admin"):
        return error("role must be 'member', 'admin', or 'super_admin'")

    try:
        user = db.create_user(email, name, role)
    except ValueError as exc:  # duplicate email
        return error(str(exc), 409)
    return jsonify(user), 201


def _can_manage(actor, target):
    """Access/deletion rights: super-admins manage everyone; regular admins may
    only manage members (not other admins or super-admins)."""
    if actor["role"] == "super_admin":
        return True
    if actor["role"] == "admin":
        return target["role"] == "member"
    return False


@app.patch("/api/admin/users/<user_id>")
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

    # Self-protection. Compare as strings so it holds for both id modes
    # (STRING uuid default and INT64), since the path value arrives as a string.
    if str(user_id) == str(g.user["id"]):
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


@app.delete("/api/admin/users/<user_id>")
@admin_required
def admin_delete_user(user_id):
    """Delete a user. **Super-admins only.** Nobody can delete themselves or the
    last active super-admin."""
    if g.user["role"] != "super_admin":
        return error("only a super admin can delete users", 403)
    target = db.get_user_by_id(user_id)
    if target is None:
        return error("user not found", 404)
    if str(user_id) == str(g.user["id"]):
        return error("you cannot delete your own account")
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
    rows = db.list_exams()
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

    row = db.create_exam(
        name, data.get("date"), num_q,
        float(data.get("marksCorrect", 4)), float(data.get("marksPenalty", 1)),
        key,
    )
    return jsonify(db.row_to_exam(row)), 201


@app.get("/api/exams/<int:exam_id>")
@login_required
def get_exam(exam_id):
    """Fetch a single exam by id."""
    row = db.get_exam(exam_id)
    if row is None:
        return error("exam not found", 404)
    return jsonify(db.row_to_exam(row))


@app.put("/api/exams/<int:exam_id>")
@login_required
def update_exam(exam_id):
    """Update mutable fields of an exam. Accepts the same body as create;
    every field is optional and only provided fields are changed."""
    data = request.get_json(silent=True) or {}
    row = db.get_exam(exam_id)
    if row is None:
        return error("exam not found", 404)

    num_q = int(data.get("numQuestions", row["num_questions"]))
    try:
        key = (_validate_answer_key(data["answerKey"], num_q)
               if "answerKey" in data else json.loads(row["answer_key"]))
    except ValueError as exc:
        return error(str(exc))

    row = db.update_exam(
        exam_id,
        data.get("name", row["name"]),
        data.get("date", row["exam_date"]),
        num_q,
        float(data.get("marksCorrect", row["marks_correct"])),
        float(data.get("marksPenalty", row["marks_penalty"])),
        key,
    )
    return jsonify(db.row_to_exam(row))


@app.delete("/api/exams/<int:exam_id>")
@login_required
def delete_exam(exam_id):
    """Delete an exam and cascade-remove its sheets and results."""
    if not db.delete_exam(exam_id):
        return error("exam not found", 404)
    return "", 204


# --------------------------------------------------------------------------- #
# Uploads
# --------------------------------------------------------------------------- #
@app.get("/api/exams/<int:exam_id>/sheets")
@login_required
def list_sheets(exam_id):
    """List every uploaded sheet for an exam (the upload queue)."""
    rows = db.list_sheets(exam_id)
    return jsonify([db.row_to_sheet(r) for r in rows])


@app.post("/api/exams/<int:exam_id>/upload")
@login_required
def upload_sheets(exam_id):
    """Upload one or more scanned answer sheets (``multipart/form-data``).

    Send files under the form field ``files``. Each file is validated by
    extension (pdf/jpg/jpeg/png). Recognised files are stored, run through the
    (stubbed) mark detector, and marked ``validated``; unrecognised files are
    recorded with status ``failed``. Returns the created sheet records.

    Form field ``sheetQuestions`` declares how many question slots are *printed*
    on the form (100 or 200). This is the sheet's layout, not the exam's
    question count — a 50-question exam is often sat on a 200-question form, and
    the reader needs the printed geometry to number answers correctly.
    """
    exam = db.get_exam(exam_id)
    if exam is None:
        return error("exam not found", 404)

    try:
        sheet_questions = int(
            request.form.get("sheetQuestions")
            or omr_pipeline.DEFAULT_SHEET_QUESTIONS
        )
    except (TypeError, ValueError):
        return error("'sheetQuestions' must be a number")
    if sheet_questions not in omr_pipeline.SHEET_TEMPLATES:
        return error(
            "unsupported 'sheetQuestions' "
            f"{sheet_questions}; supported: "
            f"{sorted(omr_pipeline.SHEET_TEMPLATES)}"
        )

    files = request.files.getlist("files")
    if not files:
        return error("no files provided under form field 'files'")

    created = []
    for f in files:
        fname = secure_filename(f.filename or "unnamed")
        ext = os.path.splitext(fname)[1].lower()
        blob = f.read()
        size = len(blob)

        if ext not in ALLOWED_EXT:
            row = db.create_sheet(
                exam_id, fname, size, status="failed",
                error="Unrecognized format",
            )
            created.append(db.row_to_sheet(row))
            continue

        path = os.path.join(UPLOAD_DIR, f"{exam_id}_{fname}")
        with open(path, "wb") as out:
            out.write(blob)

        # A single PDF can bundle several students' sheets (one per page), so
        # register one sheet record per page. Images are always a single sheet.
        pages = _pdf_page_count(blob) if ext == ".pdf" else 1
        base, base_ext = os.path.splitext(fname)
        for page in range(pages):
            sheet_name = f"{base} [page {page + 1}]{base_ext}" if pages > 1 else fname
            try:
                # Real OMR: read the actually-marked bubbles off the scan. The
                # reader also flags filling-rule issues (double / faint marks),
                # and optionally OCRs the handwritten student name.
                read = omr_pipeline.read_sheet(
                    path, page=page, read_name=NAME_OCR,
                    sheet_questions=sheet_questions,
                )
                row = db.create_sheet(
                    exam_id, sheet_name, size, status="validated",
                    roll_number=None, student_name=read.get("name"),
                    answers=read["answers"], flags=read["flags"],
                )
            except Exception as exc:  # unreadable scan / unexpected layout
                app.logger.exception("OMR read failed for %s page %s", fname, page)
                row = db.create_sheet(
                    exam_id, sheet_name, size, status="failed",
                    error=f"Could not read sheet: {exc}",
                )
            created.append(db.row_to_sheet(row))
    return jsonify(created), 201


@app.patch("/api/sheets/<int:sheet_id>")
@login_required
def update_sheet(sheet_id):
    """Manually set a sheet's student name and/or roll number.

    Body: ``{ "studentName": "...", "rollNumber": "..." }`` — both optional;
    only provided fields change. This overrides what OCR read (or left blank)
    and never affects the detected answers or grading. Returns the updated
    sheet record.
    """
    data = request.get_json(silent=True) or {}
    name = data.get("studentName")
    roll = data.get("rollNumber")
    if name is None and roll is None:
        return error("provide 'studentName' and/or 'rollNumber'")
    updated = db.update_sheet_identity(
        sheet_id,
        student_name=name.strip() if isinstance(name, str) else None,
        roll_number=roll.strip() if isinstance(roll, str) else None,
    )
    if updated is None:
        return error("sheet not found", 404)
    return jsonify(db.row_to_sheet(updated))


def _sheet_source(exam_id, filename):
    """Map a sheet's display filename back to the stored upload path + page.

    A multi-page PDF is stored once under ``{exam_id}_{original}`` and each page
    becomes a sheet named ``"<base> [page N]<ext>"``; single files keep their
    name. Returns ``(path, page_index)``."""
    m = re.match(r"^(.*) \[page (\d+)\](\.[^.]+)$", filename)
    if m:
        source = m.group(1) + m.group(3)
        page = int(m.group(2)) - 1
    else:
        source, page = filename, 0
    return os.path.join(UPLOAD_DIR, f"{exam_id}_{source}"), page


@app.get("/api/sheets/<int:sheet_id>/image")
@login_required
def sheet_image(sheet_id):
    """Render the scanned sheet (the exact page this result came from) as a PNG.

    Lets a reviewer read the handwritten name off the scan and attribute the
    score — essential when no roll number was filled and OCR is unavailable.
    """
    sheet = db.get_sheet(sheet_id)
    if sheet is None:
        return error("sheet not found", 404)
    path, page = _sheet_source(sheet["exam_id"], sheet["filename"])
    if not os.path.exists(path):
        return error("scanned file is no longer on the server", 404)
    try:
        import cv2
        gray = omr_pipeline._render_gray(path, page=page)
        ok, buf = cv2.imencode(".png", gray)
        if not ok:
            return error("could not render sheet", 500)
    except Exception as exc:
        app.logger.exception("sheet image render failed for sheet %s", sheet_id)
        return error(f"could not render sheet: {exc}", 500)
    return Response(buf.tobytes(), mimetype="image/png")


@app.delete("/api/sheets/<int:sheet_id>")
@login_required
def delete_sheet(sheet_id):
    """Remove a single sheet from the queue (and its result, if graded)."""
    if not db.delete_sheet(sheet_id):
        return error("sheet not found", 404)
    return "", 204


@app.get("/api/exams/<int:exam_id>/validation")
@login_required
def validation_summary(exam_id):
    """Return the upload-screen validation summary for an exam::

        {
          "totalDetected": 51,
          "readyForGrading": 50,
          "flagged": 3,
          "issues": 4,
          "issueDetails": [
            "1 sheet(s) could not be read.",
            "3 sheet(s) violate the filling instructions and need review."
          ]
        }

    A missing roll number does **not** block grading — any sheet that was read
    successfully is counted in ``readyForGrading``.
    """
    rows = [db.row_to_sheet(r) for r in db.list_sheets(exam_id)]

    total = len(rows)
    failed = [r for r in rows if r["status"] == "failed"]
    # Sheets that were read fine but violate the filling instructions
    # (incomplete darkening, double/stray marks, erasing, pencil, …).
    flagged = [r for r in rows if r["status"] == "validated" and r["flags"]]
    # Every readable sheet is gradeable, roll number or not.
    ready = sum(1 for r in rows if r["status"] == "validated")

    details = []
    if failed:
        details.append(f"{len(failed)} sheet(s) could not be read.")
    if flagged:
        details.append(
            f"{len(flagged)} sheet(s) violate the filling instructions and need review."
        )

    return jsonify({
        "totalDetected": total,
        "readyForGrading": ready,
        "flagged": len(flagged),
        "issues": len(failed) + len(flagged),
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
    exam = db.get_exam(exam_id)
    if exam is None:
        return error("exam not found", 404)

    answer_key = json.loads(exam["answer_key"])
    if not answer_key:
        return error("answer key is empty; configure it before grading")

    sheets = db.list_validated_sheets(exam_id)

    computed = []
    for s in sheets:
        res = grade(answer_key, json.loads(s["answers"]),
                    exam["marks_correct"], exam["marks_penalty"])
        computed.append({
            "sheetId": s["id"],
            "correct": res["correct"],
            "wrong": res["wrong"],
            "unattempted": res["unattempted"],
            "score": res["score"],
            "maxScore": res["maxScore"],
        })
    graded = db.replace_results(exam_id, computed)
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
    exam = db.get_exam(exam_id)
    if exam is None:
        return error("exam not found", 404)
    rows = db.list_results(exam_id)

    result_rows = [{
        "sheetId": r["sheet_id"],
        "rollNumber": r["roll_number"],
        "studentName": r["student_name"],
        "filename": r["filename"],
        "flags": json.loads(r["flags"]) if r.get("flags") else [],
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


# --------------------------------------------------------------------------- #
# Public standalone tools (/image-resizer, /answerkey-checker)
# --------------------------------------------------------------------------- #
# These two endpoints are intentionally UNAUTHENTICATED — the tools they serve
# run on the public adda247.com site, not inside the portal. They are
# append-only writes to their own BigQuery tables and touch nothing else.
#
# Because they are open, each one is: payload-size capped, field-length capped
# (see tools_store), and rate-limited per client IP below.
TOOLS_RATE_LIMIT = int(os.environ.get("OMR_TOOLS_RATE_LIMIT", "30"))  # per minute
TOOLS_MAX_JSON_BYTES = 64 * 1024

# ip -> [timestamps]. Best-effort only: per-process (each gunicorn worker keeps
# its own) and reset on restart. It blunts accidental loops and casual abuse,
# not a determined attacker — put a real limiter at the edge for that.
_tools_hits = {}


def _rate_limited(ip):
    import time

    now = time.time()
    hits = [t for t in _tools_hits.get(ip, []) if now - t < 60]
    if len(hits) >= TOOLS_RATE_LIMIT:
        _tools_hits[ip] = hits
        return True
    hits.append(now)
    _tools_hits[ip] = hits
    if len(_tools_hits) > 10_000:  # bound the dict; drop the coldest entries
        for stale in [k for k, v in _tools_hits.items() if not v or now - v[-1] > 60][:5_000]:
            _tools_hits.pop(stale, None)
    return False


def _client_ip():
    fwd = request.headers.get("X-Forwarded-For", "")
    return (fwd.split(",")[0].strip() if fwd else request.remote_addr) or "unknown"


def _tools_payload():
    """Validate size and shape of a public tool payload. Returns (data, error)."""
    if request.content_length and request.content_length > TOOLS_MAX_JSON_BYTES:
        return None, error("payload too large", 413)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, error("a JSON object body is required")
    return data, None


def _tools_save(save_fn, payload):
    """Run a tools_store write, mapping failures to a response.

    A logging failure must never look like a tool failure to the candidate, so
    the frontend treats any non-2xx here as "carry on regardless"."""
    try:
        row_id = save_fn(
            payload,
            user_agent=request.headers.get("User-Agent"),
            referrer=request.headers.get("Referer"),
        )
    except Exception as exc:  # noqa: BLE001 — never leak internals publicly
        app.logger.warning("tools: BigQuery write failed: %s", exc)
        return error("could not record this request", 503)
    return jsonify({"status": "ok", "id": row_id}), 201


@app.post("/api/tools/image-resizer/leads")
def tools_resizer_lead():
    """Record one image-resizer download: the captured lead plus what was
    produced. Public. The image itself never leaves the browser — only its
    filename and dimensions are stored."""
    if _rate_limited(_client_ip()):
        return error("too many requests; try again in a minute", 429)
    data, err = _tools_payload()
    if err:
        return err

    lead = data.get("lead") or {}
    if not str(lead.get("name") or "").strip():
        return error("lead name is required")
    if not str(lead.get("phone") or "").strip():
        return error("lead phone is required")

    return _tools_save(tools_store.save_resizer_lead, data)


@app.post("/api/tools/answerkey-checker/results")
def tools_keycheck_result():
    """Record one answer-key analysis. Public. Aggregates only — individual
    responses and the answer key are never stored."""
    if _rate_limited(_client_ip()):
        return error("too many requests; try again in a minute", 429)
    data, err = _tools_payload()
    if err:
        return err
    if not isinstance(data.get("stats"), dict):
        return error("stats object is required")

    return _tools_save(tools_store.save_keycheck_result, data)


if __name__ == "__main__":
    # Deployment-configurable. Bind 0.0.0.0 in containers so the port is
    # reachable; PORT is the convention used by most PaaS providers.
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes", "on")
    app.run(host=host, port=port, debug=debug)
