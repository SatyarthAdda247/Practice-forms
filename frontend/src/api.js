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

// Keep in step with MAX_FILE_BYTES in backend/app.py, which Flask applies as
// MAX_CONTENT_LENGTH. Anything bigger is rejected with a 413 mid-upload, so it
// is worth catching here: the candidate gets a straight answer instead of
// watching a large file upload and then fail.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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

// --- Diagnosing a thrown fetch ---------------------------------------------
// fetch() rejects with a bare "Failed to fetch" for offline, DNS, TLS, mixed
// content AND for a response the browser refused to read. That last case is the
// one that used to be reported as "cannot reach the server", which sent people
// to check their network while the API was perfectly healthy:
//
//   a gateway-generated 5xx (upstream reset because a worker was OOM-killed, or
//   an upstream timeout) never passes through Flask, so flask_cors never adds
//   Access-Control-Allow-Origin — and cross-origin, a response without that
//   header is unreadable, which surfaces as a *network* error, not a status.
//
// So the two are told apart by asking the server whether it is alive. Health is
// a plain GET with no custom headers, so it needs no preflight and answers in
// milliseconds.
const HEALTH_TIMEOUT = 6000;

// Errors carry a `kind` so callers can tell "this request is doomed" (bad
// input, 404, 413) from "the API blinked" (gateway 5xx, pod restart), which is
// worth waiting out and retrying.
const RETRYABLE_KINDS = new Set(["gateway", "unreachable", "dropped"]);

function apiError(message, kind, status) {
  const err = new Error(message);
  err.kind = kind;
  if (status) err.status = status;
  return err;
}

export const isRetryableError = (err) => RETRYABLE_KINDS.has(err?.kind);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverIsUp() {
  try {
    const res = await fetch(`${BASE}/health`, {
      method: "GET",
      cache: "no-store",
      // Belt and braces: AbortSignal.timeout is recent enough that a stale
      // browser would otherwise leave this hanging.
      signal: AbortSignal.timeout?.(HEALTH_TIMEOUT),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// A gateway 503 means the ingress had no healthy backend — the pod is
// restarting (OOM-killed by a heavy scan, rolling deploy, failed readiness
// probe). It comes back in seconds, so poll /health instead of failing the
// whole batch. Returns false if it never does.
const SERVER_WAIT_MS = 120_000;

export async function waitForServer({ timeoutMs = SERVER_WAIT_MS, onWait } = {}) {
  const started = Date.now();
  for (let attempt = 1; Date.now() - started < timeoutMs; attempt++) {
    if (await serverIsUp()) return true;
    onWait?.({ attempt, elapsedMs: Date.now() - started, timeoutMs });
    await sleep(Math.min(2000 * attempt, 8000));
  }
  return serverIsUp();
}

async function describeFetchFailure(err, method, path) {
  console.error(`[api] ${method} ${BASE}${path} failed`, err);

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return apiError("You appear to be offline. Reconnect, then try again.", "offline");
  }
  if (err?.name === "AbortError" || err?.name === "TimeoutError") {
    return apiError(
      `The request to ${path} was cancelled before it finished.`,
      "aborted"
    );
  }
  if (await serverIsUp()) {
    // The API is answering, so this is not connectivity — this one request died.
    return apiError(
      `The server is running, but it dropped this request (${method} ${path}) ` +
        `without a readable response. That usually means the request was too large, ` +
        `took too long, or the worker handling it was killed. Open the browser ` +
        `console for the status code, then check the server logs.`,
      "dropped"
    );
  }
  return apiError(
    `Cannot reach the server at ${API_ORIGIN || window.location.origin}. ` +
      `It may be restarting — wait a moment and try again.`,
    "unreachable"
  );
}

async function request(path, options = {}) {
  const { fresh, ...init } = options;
  const method = (init.method || "GET").toUpperCase();
  const isGet = method === "GET";

  // `fresh` skips the cache read — used when the answer has to reflect a write
  // that may or may not have landed (see uploadSheets' duplicate check).
  if (isGet && !fresh) {
    const hit = getCache.get(path);
    if (hit && Date.now() - hit.ts < GET_CACHE_TTL) {
      return hit.body; // instant — served from cache
    }
  }

  const token = tokenStore.get();
  const headers = { ...(init.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (e) {
    throw await describeFetchFailure(e, method, path);
  }

  if (res.status === 401) {
    tokenStore.clear();
    clearApiCache();
    if (onUnauthorized) onUnauthorized();
    throw apiError("Your session has expired. Please sign in again.", "auth", 401);
  }
  if (res.status === 204) {
    clearApiCache(); // a successful mutation may have changed anything
    return null;
  }

  // 502/503/504 never came from Flask — the ingress answered because no pod was
  // healthy. Same situation as the unreadable cross-origin failure above, so
  // give it the same kind and let callers wait it out.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw apiError(
      `The server is restarting and did not accept this request (${res.status}). ` +
        `It usually recovers within a few seconds.`,
      "gateway",
      res.status
    );
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw apiError(
      (body && body.error) || `Request failed (${res.status})`,
      "http",
      res.status
    );
  }

  if (isGet) {
    getCache.set(path, { ts: Date.now(), body });
  } else {
    clearApiCache(); // writes invalidate cached reads
  }
  return body;
}

// --- Upload recovery -------------------------------------------------------
// How many times a single file is re-sent after the API drops out. Two covers a
// pod restart plus one unlucky follow-up; beyond that something is properly
// broken and the batch should say so rather than hammer the server.
const UPLOAD_RETRIES = 2;

// The server stores files through secure_filename() (spaces and odd characters
// become underscores) and expands a multi-page PDF into "name [page 2].pdf", so
// filenames are compared on a loose key rather than character-for-character.
const sheetKey = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/\s*\[page \d+\]/g, "")
    .replace(/[^a-z0-9.]+/g, "");

async function listSheetsFresh(examId) {
  try {
    return (await request(`/exams/${examId}/sheets`, { fresh: true })) || [];
  } catch {
    return []; // best-effort: the caller falls back to re-sending the file
  }
}

// Sheets for `filename` that were not there before the batch started — i.e. the
// upload actually landed even though the response never made it back.
async function landedSheets(examId, filename, idsBefore) {
  const key = sheetKey(filename);
  const rows = await listSheetsFresh(examId);
  return rows.filter((s) => !idsBefore.has(s.id) && sheetKey(s.filename) === key);
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
  //
  // ONE REQUEST PER FILE, deliberately. Batching every file into a single
  // FormData meant the server's MAX_CONTENT_LENGTH (50 MB) applied to the whole
  // batch, so three 20 MB scans were rejected with a 413 even though the screen
  // promises "50 MB each" — and one oversized file failed the entire drop. A
  // request per file makes the advertised limit the real one, keeps each request
  // short, and lets the good files land when one is bad.
  //
  // Sequential rather than parallel: the backend does real work per sheet, and
  // firing N concurrent uploads at it is how workers get starved.
  //
  // Reading a scan is CPU- and memory-heavy, so a bad one can take the pod down
  // mid-batch; the ingress then answers 503 with no CORS headers and the browser
  // reports it as a bare network failure. That used to kill every remaining file
  // in the drop. Now a gateway-class failure waits for /health to answer again
  // and re-sends the file — after checking it did not already land, because the
  // pod can die *after* the sheet was written.
  uploadSheets: async (id, files, sheetQuestions = 200, onProgress) => {
    const list = [...files];
    const created = [];
    const failures = [];
    // Snapshot of what already existed, so a retry can tell "this sheet landed
    // on the attempt that died" from "a sheet with this name was uploaded
    // earlier" and only skip the former.
    const idsBefore = new Set((await listSheetsFresh(id)).map((s) => s.id));

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const base = { index: i, total: list.length, name: file.name };
      let err = null;
      let serverGone = false;

      for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
        if (attempt > 0) {
          onProgress?.({ ...base, waiting: true, attempt });
          if (!(await waitForServer({ onWait: () => onProgress?.({ ...base, waiting: true, attempt }) }))) {
            serverGone = true;
            break; // still down — keep the error from the failed attempt
          }
          const landed = await landedSheets(id, file.name, idsBefore);
          if (landed.length) {
            landed.forEach((s) => idsBefore.add(s.id));
            created.push(...landed); // it did make it; re-sending would duplicate
            err = null;
            break;
          }
        }
        onProgress?.({ ...base, attempt });

        const fd = new FormData();
        fd.append("files", file);
        fd.append("sheetQuestions", String(sheetQuestions));
        try {
          const rows = await request(`/exams/${id}/upload`, { method: "POST", body: fd });
          if (Array.isArray(rows)) {
            rows.forEach((s) => idsBefore.add(s.id));
            created.push(...rows);
          }
          err = null;
          break;
        } catch (e) {
          err = e;
          if (!isRetryableError(e)) break; // 413, 404, bad input — retrying changes nothing
        }
      }

      if (err) failures.push(`${file.name}: ${err.message}`);

      // The API stayed down through the whole wait. Making every remaining file
      // repeat that wait would leave the screen busy for minutes and still fail,
      // so stop and name what was not sent.
      if (serverGone) {
        const skipped = list.slice(i + 1);
        if (skipped.length) {
          failures.push(
            `Stopped after ${file.name} — the server did not come back. ` +
              `Not uploaded: ${skipped.map((f) => f.name).join(", ")}. Try again once it is up.`
          );
        }
        break;
      }
    }

    // Every file failed — there is nothing to show, so this is an error, not a
    // partial success. One message per file, because the reasons can differ.
    if (failures.length && !created.length) throw new Error(failures.join(" · "));
    return { created, failures };
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
  let res;
  try {
    res = await fetch(`${BASE}${path}`, options);
  } catch (err) {
    // Same trap as request(): a CORS-less gateway 5xx looks like a dead network.
    throw await describeFetchFailure(err, (options?.method || "GET").toUpperCase(), path);
  }
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
