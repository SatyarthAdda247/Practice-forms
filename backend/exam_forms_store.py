"""Persist practice exam-form submissions to DynamoDB.

The exam-form replicas (IBPS PO / IBPS Clerk / …) are static, client-side
practice forms. This module is the ONLY place their captured data touches a
server: the frontend POSTs a snapshot to /api/exam-forms/save and this writes
it to DynamoDB.

Credentials never reach the browser. boto3 resolves AWS credentials from the
standard chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars, a shared
profile, or an IAM role) — configure them server-side only.

Single-table design (matches the frontend practiceStore convention):
    PK = STUDENT#<identifier>      (identifier = mobile or email)
    SK = EXAM#<examId>            (e.g. EXAM#IBPS-CLERK)
An upsert overwrites the same item as the candidate progresses, so the table
holds one current row per (candidate, exam).
"""

import os
import time


class Unavailable(RuntimeError):
    """Raised when DynamoDB writes are not configured/available.

    The endpoint maps this to a 503 so a storage outage never breaks the
    candidate's practice run (the frontend ignores the response)."""


# Lazily-created boto3 table handle, cached across requests.
_TABLE = None
_INIT_ERROR = None


def _table():
    """Return a cached DynamoDB Table resource, or raise Unavailable."""
    global _TABLE, _INIT_ERROR
    if _TABLE is not None:
        return _TABLE
    if _INIT_ERROR is not None:
        raise Unavailable(_INIT_ERROR)

    table_name = os.environ.get("EXAM_FORMS_DDB_TABLE", "").strip()
    if not table_name:
        _INIT_ERROR = "EXAM_FORMS_DDB_TABLE is not set"
        raise Unavailable(_INIT_ERROR)

    try:
        import boto3  # imported lazily so the backend runs without boto3 installed
    except ImportError:
        _INIT_ERROR = "boto3 is not installed"
        raise Unavailable(_INIT_ERROR)

    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "ap-south-1"
    )
    try:
        resource = boto3.resource("dynamodb", region_name=region)
        _TABLE = resource.Table(table_name)
    except Exception as exc:  # noqa: BLE001
        _INIT_ERROR = f"could not initialise DynamoDB: {exc}"
        raise Unavailable(_INIT_ERROR)
    return _TABLE


def _sanitize(value):
    """DynamoDB rejects empty strings inside some contexts and cannot store
    floats via the resource API; keep values to JSON-safe str/num/bool/dict."""
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    if isinstance(value, float):
        # Dynamo resource wants Decimal for numbers; store floats as strings.
        return str(value)
    return value


def save(exam_id, identifier, data, step=None, user_agent=None, referrer=None):
    """Upsert one candidate's current exam-form snapshot. Returns the PK/SK.

    Raises Unavailable if DynamoDB is not configured (endpoint -> 503)."""
    exam_id = str(exam_id or "").strip()
    identifier = str(identifier or "").strip()
    if not exam_id or not identifier:
        raise ValueError("examId and identifier are required")

    table = _table()
    now = int(time.time())
    clean = _sanitize(data if isinstance(data, dict) else {})
    item = {
        "PK": f"STUDENT#{identifier}",
        "SK": f"EXAM#{exam_id}",
        "examId": exam_id,
        "identifier": identifier,
        "data": clean,
        "updatedAt": now,
    }
    if step is not None:
        item["step"] = str(step)

    # Promote the candidate's name/phone to top-level attributes so the table is
    # directly readable (count users, list names) without parsing the data blob.
    cand_name = clean.get("name") or clean.get("id:fullname") or ""
    cand_phone = (
        clean.get("phone")
        or clean.get("id:txtmobile")
        or (identifier if str(identifier).isdigit() else "")
    )
    if cand_name:
        item["candidateName"] = str(cand_name)[:128]
    if cand_phone:
        item["candidatePhone"] = str(cand_phone)[:20]
    if user_agent:
        item["userAgent"] = str(user_agent)[:512]
    if referrer:
        item["referrer"] = str(referrer)[:512]

    try:
        # Preserve the first-seen timestamp without an extra read.
        table.update_item(
            Key={"PK": item["PK"], "SK": item["SK"]},
            UpdateExpression=(
                "SET #d = :d, examId = :e, identifier = :i, updatedAt = :u"
                + (", step = :s" if step is not None else "")
                + (", candidateName = :cn" if "candidateName" in item else "")
                + (", candidatePhone = :cp" if "candidatePhone" in item else "")
                + (", userAgent = :ua" if user_agent else "")
                + (", referrer = :r" if referrer else "")
                + ", createdAt = if_not_exists(createdAt, :u)"
            ),
            ExpressionAttributeNames={"#d": "data"},
            ExpressionAttributeValues={
                ":d": item["data"],
                ":e": exam_id,
                ":i": identifier,
                ":u": now,
                **({":s": item["step"]} if step is not None else {}),
                **({":cn": item["candidateName"]} if "candidateName" in item else {}),
                **({":cp": item["candidatePhone"]} if "candidatePhone" in item else {}),
                **({":ua": item["userAgent"]} if user_agent else {}),
                **({":r": item["referrer"]} if referrer else {}),
            },
        )
    except Unavailable:
        raise
    except Exception as exc:  # noqa: BLE001 — surface as Unavailable (503)
        raise Unavailable(f"DynamoDB write failed: {exc}")

    return {"PK": item["PK"], "SK": item["SK"]}
