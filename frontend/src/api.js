// Thin fetch wrapper around the Flask API.
// - Dev: leave VITE_API_BASE_URL unset -> "/api" (Vite proxies it to :5000).
// - Split-domain prod: set VITE_API_BASE_URL to the backend origin at build
//   time (e.g. https://tools-api.adda247.com) -> "<origin>/api".
// Deployed frontend host -> its backend origin. This is the safety net for a
// missing or unsubstituted VITE_API_BASE_URL: without it the app fell back to
// same-origin, which is wrong under split-domain and produced requests to a
// host that does not exist. Keep in sync with the ConfigMaps in DEPLOYMENT.md.
const API_ORIGIN_BY_HOST = {
  "tools.adda247.com": "https://tools-api.adda247.com",
};

function resolveApiOrigin() {
  const raw = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
  // The Docker build bakes a __VITE_API_BASE_URL__ token that the container
  // entrypoint substitutes from the ConfigMap. If it survives to the browser
  // the injection never ran.
  const missing = !raw || raw.startsWith("__VITE");
  if (!missing) return raw;

  // Known deployed host -> its API origin. Anywhere else (localhost) keeps the
  // same-origin "/api", which `npm run dev` proxies to the Flask server.
  const fallback = API_ORIGIN_BY_HOST[window.location.hostname] || "";
  if (raw.startsWith("__VITE")) {
    console.error(
      `[api] VITE_API_BASE_URL placeholder was not replaced at container start — ` +
        `using ${fallback || "same-origin /api"}. Fix docker-entrypoint.sh and the ConfigMap.`
    );
  }
  return fallback;
}

const API_ORIGIN = resolveApiOrigin();
const BASE = `${API_ORIGIN}/api`;
const TOKEN_KEY = "omr_token";

// Session-token storage + a hook the auth layer registers so a 401 anywhere
// can force a sign-out.
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// --- Lightweight GET cache -------------------------------------------------
// Caches successful GET responses in memory for a short window so revisiting a
// page renders instantly instead of waiting on a network round-trip. Any write
// (POST/PUT/PATCH/DELETE) or a 401 clears the cache so data never goes stale
// after a change.
const GET_CACHE_TTL = 30_000; // ms
const getCache = new Map(); // path -> { ts, body }

export function clearApiCache() {
  getCache.clear();
}

async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isGet = method === "GET";

  if (isGet) {
    const hit = getCache.get(path);
    if (hit && Date.now() - hit.ts < GET_CACHE_TTL) {
      return hit.body; // instant — served from cache
    }
  }

  const token = tokenStore.get();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // fetch() rejects with a bare "Failed to fetch" for DNS failures, refused
  // connections, mixed content and CORS rejections alike. Name the origin we
  // could not reach so a misconfigured API base URL is obvious from the UI.
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch (e) {
    console.error(`[api] request to ${BASE}${path} failed`, e);
    throw new Error(
      `Cannot reach the server at ${API_ORIGIN || window.location.origin}. ` +
        `Check your connection, then reload the page.`
    );
  }

  if (res.status === 401) {
    tokenStore.clear();
    clearApiCache();
    if (onUnauthorized) onUnauthorized();
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (res.status === 204) {
    clearApiCache(); // a successful mutation may have changed anything
    return null;
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((body && body.error) || `Request failed (${res.status})`);
  }

  if (isGet) {
    getCache.set(path, { ts: Date.now(), body });
  } else {
    clearApiCache(); // writes invalidate cached reads
  }
  return body;
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  // Auth
  googleLogin: (credential) => request("/auth/google", json("POST", { credential })),
  register: (data) => request("/auth/register", json("POST", data)),
  loginLocal: (data) => request("/auth/login", json("POST", data)),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),

  // Admin — manage access
  adminListUsers: () => request("/admin/users"),
  adminCreateUser: (data) => request("/admin/users", json("POST", data)),
  adminUpdateUser: (id, data) => request(`/admin/users/${id}`, json("PATCH", data)),
  adminDeleteUser: (id) => request(`/admin/users/${id}`, { method: "DELETE" }),
  // Daily OMR processing volume for the usage dashboard.
  adminUsage: (days = 30) => request(`/admin/usage?days=${days}`),
  // Lead access is granted by a super admin; the leads themselves are then
  // readable by that user.
  adminListLeadAccess: () => request("/admin/lead-access"),
  adminGrantLeadAccess: (email) => request("/admin/lead-access", json("POST", { email })),
  adminRevokeLeadAccess: (email) =>
    request(`/admin/lead-access/${encodeURIComponent(email)}`, { method: "DELETE" }),
  leads: (days = 30) => request(`/tools/leads?days=${days}`),

  // Exams + answer keys
  listExams: () => request("/exams"),
  getExam: (id) => request(`/exams/${id}`),
  createExam: (data) => request("/exams", json("POST", data)),
  updateExam: (id, data) => request(`/exams/${id}`, json("PUT", data)),
  deleteExam: (id) => request(`/exams/${id}`, { method: "DELETE" }),

  // Uploads
  listSheets: (id) => request(`/exams/${id}/sheets`),
  // sheetQuestions = how many questions are PRINTED on the form (100 | 200),
  // which is the sheet's layout, not the exam's question count.
  uploadSheets: (id, files, sheetQuestions = 200) => {
    const fd = new FormData();
    [...files].forEach((f) => fd.append("files", f));
    fd.append("sheetQuestions", String(sheetQuestions));
    return request(`/exams/${id}/upload`, { method: "POST", body: fd });
  },
  updateSheet: (id, data) => request(`/sheets/${id}`, json("PATCH", data)),
  deleteSheet: (id) => request(`/sheets/${id}`, { method: "DELETE" }),
  // Fetch the scanned sheet image as an object URL (blob), sending the auth
  // token — an <img src> can't set the Authorization header. Caller must
  // URL.revokeObjectURL() it when done.
  sheetImageUrl: async (id) => {
    const token = tokenStore.get();
    const res = await fetch(`${BASE}/sheets/${id}/image`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Could not load sheet image (${res.status})`);
    return URL.createObjectURL(await res.blob());
  },
  validation: (id) => request(`/exams/${id}/validation`),

  // Grading + results
  grade: (id) => request(`/exams/${id}/grade`, { method: "POST" }),
  results: (id) => request(`/exams/${id}/results`),
};

// --- Public standalone tools ----------------------------------------------
// Deliberately NOT routed through request(): those pages are public, so they
// must never attach a session token, and a failure there must never trip the
// 401 handler and sign a portal user out. Logging is fire-and-forget — the
// candidate's download or score must not depend on the warehouse write.
async function toolLog(path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`tool logging failed (${path}):`, err.message);
    return null;
  }
}

// Same reasoning as toolLog (public: never send a token, never trip the 401
// handler) — but these two calls are the feature rather than telemetry, so a
// failure has to reach the candidate instead of being swallowed.
async function toolCall(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body;
}

export const toolsApi = {
  logResizerLead: (payload) => toolLog("/tools/image-resizer/leads", payload),
  logKeyCheckResult: (payload) => toolLog("/tools/answerkey-checker/results", payload),

  // Pull a response-sheet page down through the backend. It cannot be fetched
  // here: the exam CDNs send no CORS headers and reject a non-browser
  // User-Agent. Parsing still happens in the browser — see answerKey.js.
  fetchAnswerKeyUrl: (url) =>
    toolCall("/tools/answerkey-checker/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),

  // Face detection for the resizer's health check. The one part of that tool
  // that cannot run in the browser — no shipping browser has a usable face
  // detector — so the resized JPEG is posted as raw bytes, measured with
  // OpenCV, and dropped server-side. Returns null on any failure, which the
  // checklist renders as "check manually" rather than a wrong verdict.
  checkFace: async (blob) => {
    try {
      return await toolCall("/tools/image-resizer/face-check", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
    } catch (err) {
      console.warn("face check failed:", err.message);
      return null;
    }
  },

  // Cohort rank for a score. Supplementary to the report, so a failure resolves
  // to "no rank" rather than throwing — the score is already on screen.
  keyCheckRank: async ({ exam, score, testDate }) => {
    const q = new URLSearchParams({ exam, score: String(score) });
    if (testDate) q.set("testDate", testDate);
    try {
      return await toolCall(`/tools/answerkey-checker/rank?${q}`);
    } catch (err) {
      console.warn("rank lookup failed:", err.message);
      return null;
    }
  },
};
