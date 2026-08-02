# ─── backend/exam_forms_config.example.py ────────────────────────────────────
# TEMPLATE. Copy to `exam_forms_config.py` (which is gitignored) and fill in
# real values there — the real file is loaded by exam_forms_store.py and MUST
# NEVER be committed.
#
# These are backend-only (never sent to the browser). Anything left blank falls
# back to the standard AWS env vars / instance IAM role.
#
# ⚠️  Use a TIGHTLY-SCOPED IAM user: allow only dynamodb:PutItem / UpdateItem on
#     the ONE table below. Rotate immediately if a key is ever exposed.
#
# Deployment note: because the real exam_forms_config.py is gitignored, it will
# NOT be present in the git/Docker build. In production, supply credentials via
# environment variables / a K8s secret instead (the code falls back to those):
#     EXAM_FORMS_DDB_TABLE, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

EXAM_FORMS_DDB_TABLE = "exam-forms-submissions"
AWS_REGION = "ap-south-1"
AWS_ACCESS_KEY_ID = ""
AWS_SECRET_ACCESS_KEY = ""
