# ─── backend/exam_forms_config.py ────────────────────────────────────────────
# AWS / DynamoDB credentials for exam-forms submission tracking.
#
# These live server-side only — they are NEVER sent to the browser (unlike
# frontend code). exam_forms_store.py reads them from here; anything left blank
# falls back to the standard AWS env vars / IAM role.
#
# ⚠️  SECURITY — READ THIS:
#   • Use a TIGHTLY-SCOPED IAM user: allow only dynamodb:PutItem / UpdateItem
#     (and BatchWrite if needed) on the ONE table below — nothing else.
#   • Do NOT commit real keys to a public/shared repo. `origin` here is readable
#     by others; anyone with repo access could read committed keys. Prefer
#     leaving these blank and setting the AWS_* env vars / K8s secret instead,
#     OR keep this file out of git (see backend/.gitignore) and inject it only
#     on the server.
#   • If a key is ever exposed, rotate it immediately in the AWS console.

# The DynamoDB table (composite key: PK String, SK String).
EXAM_FORMS_DDB_TABLE = "exam-forms-submissions"

# AWS region the table lives in.
AWS_REGION = "ap-south-1"

# IAM credentials. Leave blank to fall back to env vars / instance role.
AWS_ACCESS_KEY_ID = "AKIA_REDACTED_ROTATE_ME"
AWS_SECRET_ACCESS_KEY = "REDACTED_SECRET_ROTATE_ME"
