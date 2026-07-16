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
from functools import wraps

from flask import g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

import db
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
SECRET = os.environ.get("OMR_SECRET", "dev-insecure-secret-change-me")
SESSION_MAX_AGE = int(os.environ.get("OMR_SESSION_MAX_AGE", 7 * 24 * 3600))

# Only these email domains may sign in (comma-separated env override).
ALLOWED_DOMAINS = {
    d.strip().lower()
    for d in os.environ.get(
        "OMR_ALLOWED_DOMAINS", "adda247.com,studyiq.com,addaeducation.com"
    ).split(",")
    if d.strip()
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


def issue_session(user):
    """Return a signed, timed session token embedding the user identity."""
    return _serializer.dumps({
        "uid": user["id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user["picture"],
    })


def read_session(token):
    """Decode a session token, or return ``None`` if invalid/expired."""
    try:
        return _serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None


def _current_user():
    """Resolve the request's user from its Bearer token, re-reading the live
    DB record so role changes and access revocations take effect immediately.

    Returns ``(user_dict, None)`` on success or ``(None, (json, status))`` with
    an error response to return.
    """
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
    return user, None


def login_required(fn):
    """Decorator: require a valid session for an active user. Populates
    ``flask.g.user`` with the live user record (id, email, name, role, ...)."""
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
    (``admin`` or ``super_admin``)."""
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
