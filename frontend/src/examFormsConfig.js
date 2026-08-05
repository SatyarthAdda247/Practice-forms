// ─── src/examFormsConfig.js ──────────────────────────────────────────────────
// Frontend config for the exam-forms tracking dashboard.
//
// ⚠️  Everything here ships in the PUBLIC browser bundle. Put ONLY non-AWS
//     values here. AWS credentials (access key / secret) must live in the
//     BACKEND env / exam_forms_config.py — NEVER in the frontend, or they leak
//     to every visitor. The frontend talks to the backend, not to DynamoDB.

// Admin read key sent as X-Admin-Key to GET /api/exam-forms/submissions.
// Must equal the backend's EXAM_FORMS_ADMIN_KEY. This is the admin-login
// password; baking it here lets the dashboard auto-authorize. (Note: anyone
// who inspects the bundle can read the tracking list — accepted tradeoff.)
export const EXAM_ADMIN_KEY = "adda247@admin";

// Backend API origin: same-origin /api locally; split-domain in production.
const API_ORIGIN_BY_HOST = { "tools.adda247.com": "https://tools-api.adda247.com" };
export function examApiBase() {
  const h = typeof window !== "undefined" ? window.location.hostname : "";
  if (h === "localhost" || h === "127.0.0.1") return "/api";
  return (API_ORIGIN_BY_HOST[h] || "") + "/api";
}
