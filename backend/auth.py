"""Authentication helpers — Google Identity Services (GIS) sign-in.

Flow:
1. The browser obtains a Google **ID token** (JWT) via the GIS button.
2. It POSTs that token to ``/api/auth/google``.
3. :func:`verify_google_token` validates the token's signature, audience and
   issuer using Google's public certs.
4. We upsert the user and issue our own signed **session token**
   (``itsdangerous`` timed serializer) that the SPA stores and sends back as
   ``Authorization: Bearer <token>`` on every request.

Config via environment variables:
  * ``GOOGLE_CLIENT_ID`` — the OAuth 2.0 Web client ID (required for sign-in).
  * ``OMR_SECRET``       — secret used to sign session tokens (set in prod!).
  * ``OMR_SESSION_MAX_AGE`` — session lifetime in seconds (default 7 days).
"""

import os
import re
from functools import wraps

from flask import g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

import db
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
SECRET = os.environ.get("OMR_SECRET", "dev-insecure-secret-change-me")
SESSION_MAX_AGE = int(os.environ.get("OMR_SESSION_MAX_AGE", 7 * 24 * 3600))

# Impersonation ("Test as User") sessions expire far sooner than a normal one.
# A borrowed identity should not outlive the debugging session it was minted
# for, so an admin who walks away is not leaving a live member session behind.
IMPERSONATION_MAX_AGE = int(os.environ.get("OMR_IMPERSONATION_MAX_AGE", 30 * 60))

# Only these email domains may sign in (comma-separated env override).
# Values are normalised to a bare host: any scheme (http://, https://), a
# leading "www.", and path/whitespace are stripped — so a copy-pasted
# "http://adda247.com/" is treated the same as "adda247.com" rather than
# silently matching no one and locking every user out.
def _norm_domain(value):
    d = value.strip().lower()
    d = re.sub(r"^[a-z][a-z0-9+.-]*://", "", d)  # drop scheme
    d = d.split("/", 1)[0]                         # drop any path
    return d[4:] if d.startswith("www.") else d

ALLOWED_DOMAINS = {
    _norm_domain(d)
    for d in os.environ.get(
        "OMR_ALLOWED_DOMAINS", "adda247.com,studyiq.com,addaeducation.com"
    ).split(",")
    if _norm_domain(d)
}

# Emails auto-granted the super-admin role on sign-in (comma-separated).
SUPER_ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("OMR_SUPER_ADMIN_EMAILS", "").split(",")
    if e.strip()
}

# Emails auto-granted the (regular) admin role on sign-in (comma-separated).
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("OMR_ADMIN_EMAILS", "").split(",")
    if e.strip()
}

# Role hierarchy, lowest to highest.
ROLES = ("member", "admin", "super_admin")


def is_admin_role(role):
    """True for admins and super-admins (i.e. anyone with admin console access)."""
    return role in ("admin", "super_admin")

_serializer = URLSafeTimedSerializer(SECRET, salt="omr-session")


def email_domain(email):
    """Return the lowercased domain part of an email, or ''."""
    return email.rsplit("@", 1)[-1].lower() if email and "@" in email else ""


def is_allowed_domain(email):
    """True if the email belongs to an allowed organisation domain."""
    return email_domain(email) in ALLOWED_DOMAINS


def role_for_email(email):
    """Bootstrap role from env config: super-admin, then admin, else member."""
    e = (email or "").lower()
    if e in SUPER_ADMIN_EMAILS:
        return "super_admin"
    if e in ADMIN_EMAILS:
        return "admin"
    return "member"


class AuthError(Exception):
    """Raised when a Google ID token cannot be verified."""


def verify_google_token(credential):
    """Validate a Google ID token and return its claims.

    Raises :class:`AuthError` if ``GOOGLE_CLIENT_ID`` is unset or the token is
    invalid/expired/for the wrong audience.
    """
    if not GOOGLE_CLIENT_ID:
        raise AuthError(
            "Server is missing GOOGLE_CLIENT_ID; set it to your OAuth Web client ID."
        )
    try:
        info = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError as exc:  # bad signature, wrong audience, expired, etc.
        raise AuthError(f"Invalid Google token: {exc}") from exc
    except Exception as exc:  # transport/network errors reaching Google's certs
        raise AuthError(f"Could not reach Google to verify the token: {exc}") from exc

    if not info.get("email_verified", False):
        raise AuthError("Google account email is not verified.")
    return info


def issue_session(user, actor=None):
    """Return a signed, timed session token embedding the user identity.

    ``actor`` — when set, the token is an *impersonation* session: it acts as
    ``user`` on behalf of ``actor`` (the super admin who started it). The actor
    id is recorded in the token so every request can re-verify that the real
    human behind it is still allowed to be doing this, and so the audit log
    names them rather than the borrowed identity.
    """
    payload = {
        "uid": user["id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user["picture"],
    }
    if actor is not None:
        payload["act"] = {"uid": actor["id"], "email": actor["email"]}
    return _serializer.dumps(payload)


def read_session(token):
    """Decode a session token, or return ``None`` if invalid/expired.

    Impersonation tokens are held to :data:`IMPERSONATION_MAX_AGE` instead of
    the normal session lifetime. The age is re-checked after decoding rather
    than guessed up front, because the lifetime that applies depends on a claim
    inside the token itself.
    """
    try:
        payload = _serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    if isinstance(payload, dict) and payload.get("act"):
        try:
            _serializer.loads(token, max_age=IMPERSONATION_MAX_AGE)
        except (BadSignature, SignatureExpired):
            return None
    return payload


def _current_user():
    """Resolve the request's user from its Bearer token, re-reading the live
    DB record so role changes and access revocations take effect immediately.

    Also populates ``flask.g.impersonator`` — the super admin acting through
    this session, or ``None`` for an ordinary sign-in.

    Returns ``(user_dict, None)`` on success or ``(None, (json, status))`` with
    an error response to return.
    """
    g.impersonator = None
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.startswith("Bearer ") else None
    session = read_session(token) if token else None
    if session is None:
        return None, (jsonify({"error": "authentication required"}), 401)

    user = db.get_user_by_id(session.get("uid"))
    if user is None:
        return None, (jsonify({"error": "account no longer exists"}), 401)
    if not user["active"]:
        return None, (jsonify({"error": "your access has been revoked"}), 403)

    # An impersonation token is only as good as the admin who minted it. Re-read
    # the actor on every request so demoting or deactivating them immediately
    # kills any session they left running — the token alone must never be
    # enough to keep a borrowed identity alive.
    act = session.get("act") if isinstance(session, dict) else None
    if act:
        actor = db.get_user_by_id(act.get("uid"))
        if actor is None or not actor["active"] or actor["role"] != "super_admin":
            return None, (
                jsonify({"error": "impersonation session is no longer valid"}),
                403,
            )
        g.impersonator = actor
    return user, None


def login_required(fn):
    """Decorator: require a valid session for an active user. Populates
    ``flask.g.user`` with the live user record (id, email, name, role, ...).
    Returns 401/403 to unauthenticated or revoked callers."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user, err = _current_user()
        if err:
            return err
        g.user = user
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    """Decorator: like :func:`login_required` but requires an admin tier
    (``admin`` or ``super_admin``). Non-admins get 403."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user, err = _current_user()
        if err:
            return err
        if not is_admin_role(user["role"]):
            return jsonify({"error": "administrator access required"}), 403
        g.user = user
        return fn(*args, **kwargs)

    return wrapper


def super_admin_required(fn):
    """Decorator: require an active ``super_admin``, and refuse impersonated
    sessions outright.

    Guarding on the borrowed role alone would be wrong: impersonation is meant
    to *reduce* what a session can do, so a route this sensitive must be driven
    by a genuine sign-in. It also stops impersonation from chaining into itself.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user, err = _current_user()
        if err:
            return err
        if g.impersonator is not None:
            return jsonify({"error": "not available while impersonating"}), 403
        if user["role"] != "super_admin":
            return jsonify({"error": "super administrator access required"}), 403
        g.user = user
        return fn(*args, **kwargs)

    return wrapper
