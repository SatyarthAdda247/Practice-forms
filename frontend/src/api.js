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

// --- GET cache (stale-while-revalidate, survives a reload) -----------------
// Every screen here is backed by BigQuery, where even a tiny read costs a query
// job — so a cache miss is ~1s of staring at a spinner, twice over on a page
// that loads two things. The cache is what makes the app feel instant, so it
// works on three levels:
//
//   * fresh (< FRESH_TTL)  -> returned from memory, no request at all
//   * stale (< STALE_TTL)  -> returned *immediately*, and refreshed in the
//                             background so the next visit is up to date
//   * older / absent       -> fetched, with concurrent callers for the same
//                             path sharing one request instead of racing
//
// Entries are mirrored into sessionStorage, so a reload or a second tab paints
// from cache instead of starting from an empty screen. That store dies with the
// tab, is scoped to the session token, and is dropped wholesale by any write or
// a 401 — the same rules the in-memory cache has always had.
const FRESH_TTL = 30_000; // ms — serve without touching the network
const STALE_TTL = 10 * 60_000; // ms — serve, but refresh behind the scenes

const getCache = new Map(); // path -> { ts, body }
const inflight = new Map(); // path -> Promise, so callers share one request
const revalidating = new Set(); // paths being refreshed in the background

// Where the mirror lives, and what must never go into it.
const STORE_PREFIX = "omr_cache:";
const STORE_OWNER = "omr_cache_owner";
// sessionStorage is user-editable, and /auth/me is what decides which admin
// routes render. It stays memory-only: a doctored entry must not be able to
// unlock a screen, even briefly. (The API enforces access regardless.)
const NO_PERSIST = ["/auth/me"];
// Big payloads (a full results table, a long leads export) would blow the ~5 MB
// sessionStorage budget and start throwing. They stay in memory only.
const MAX_PERSIST_BYTES = 512 * 1024;

// sessionStorage is unavailable in private-mode Safari and inside some embeds,
// and every call here is an optimisation — never let one break a request.
function store(fn, fallback = null) {
  try {
    return fn(window.sessionStorage);
  } catch {
    return fallback;
  }
}

// The cached data belongs to whoever was signed in when it was fetched. If the
// token has changed (another tab signed in, or impersonation swapped identity)
// the mirror is not ours to read.
function ownsStore(ss) {
  return ss.getItem(STORE_OWNER) === (tokenStore.get() || "");
}

function readPersisted(path) {
  return store((ss) => {
    if (!ownsStore(ss)) {
      purgePersisted(ss);
      return null;
    }
    const raw = ss.getItem(STORE_PREFIX + path);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return typeof entry?.ts === "number" ? entry : null;
  });
}

function writePersisted(path, entry) {
  if (NO_PERSIST.includes(path)) return;
  store((ss) => {
    const raw = JSON.stringify(entry);
    if (raw.length > MAX_PERSIST_BYTES) return;
    if (!ownsStore(ss)) purgePersisted(ss);
    ss.setItem(STORE_OWNER, tokenStore.get() || "");
    ss.setItem(STORE_PREFIX + path, raw);
  });
}

function purgePersisted(ss) {
  // Collect first, then remove: removing while walking by index reindexes the
  // store and would skip half the entries.
  const doomed = [];
  for (let i = 0; i < ss.length; i++) {
    const key = ss.key(i);
    if (key?.startsWith(STORE_PREFIX)) doomed.push(key);
  }
  doomed.forEach((key) => ss.removeItem(key));
  ss.removeItem(STORE_OWNER);
}

// Memory first; fall back to the mirror on a cold start (reload / new tab) and
// promote the hit so later reads skip the parse.
function readCache(path) {
  const hit = getCache.get(path);
  if (hit) return hit;
  const stored = readPersisted(path);
  if (stored) getCache.set(path, stored);
  return stored;
}

function writeCache(path, body) {
  const entry = { ts: Date.now(), body };
  getCache.set(path, entry);
  writePersisted(path, entry);
}

export function clearApiCache() {
  getCache.clear();
  inflight.clear();
  revalidating.clear();
  store((ss) => purgePersisted(ss));
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

  // `fresh` skips the cache read *and* the shared-request path — used when the
  // answer has to reflect a write that may or may not have landed (see
  // uploadSheets' duplicate check), which a request started before that write
  // could not tell it.
  if (isGet && !fresh) {
    const hit = readCache(path);
    if (hit) {
      const age = Date.now() - hit.ts;
      if (age < FRESH_TTL) return hit.body; // instant — served from cache
      if (age < STALE_TTL) {
        revalidate(path, init); // instant now, fresh for the next visit
        return hit.body;
      }
    }
    // No usable entry: if an identical GET is already on the wire, wait on it
    // rather than opening a second one (two components mounting at once).
    const pending = inflight.get(path);
    if (pending) return pending;

    const p = send(path, init, method).finally(() => inflight.delete(path));
    inflight.set(path, p);
    return p;
  }

  return send(path, init, method);
}

// Refresh a stale entry out of band. The caller already has its data, so a
// failure here is not theirs to handle — it just leaves the stale entry in
// place to be retried on the next read. A 401 still signs out, via send().
function revalidate(path, init) {
  if (inflight.has(path) || revalidating.has(path)) return;
  revalidating.add(path);
  send(path, init, "GET")
    .catch(() => {})
    .finally(() => revalidating.delete(path));
}

async function send(path, init, method) {
  const isGet = method === "GET";
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
    writeCache(path, body);
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
    // `fresh` skips the browser cache; `?fresh=1` skips the server's read cache
    // too. Both matter here: a stale list would say a file never landed and the
    // retry would upload it twice.
    return (await request(`/exams/${examId}/sheets?fresh=1`, { fresh: true })) || [];
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
  // "Test as User" — both return { token, user } like sign-in does, so the
  // caller swaps the whole session rather than patching the current one.
  impersonate: (email) => request("/admin/impersonate", json("POST", { email })),
  stopImpersonating: () => request("/auth/impersonate/stop", { method: "POST" }),

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

  // Answer-key checker marking schemes. Editable by super admins and by anyone
  // they have approved via adminGrantMarkingAccess; the public tool reads the
  // same rows through toolsApi.keyCheckSchemes.
  adminListKeycheckSchemes: () => request("/admin/keycheck-schemes"),
  // PUT, because the exam slug is the key — saving twice leaves one row.
  adminSetKeycheckScheme: (data) => request("/admin/keycheck-schemes", json("PUT", data)),
  adminClearKeycheckScheme: (exam) =>
    request(`/admin/keycheck-schemes/${encodeURIComponent(exam)}`, { method: "DELETE" }),
  adminListMarkingAccess: () => request("/admin/marking-access"),
  adminGrantMarkingAccess: (email) =>
    request("/admin/marking-access", json("POST", { email })),
  adminRevokeMarkingAccess: (email) =>
    request(`/admin/marking-access/${encodeURIComponent(email)}`, { method: "DELETE" }),

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
    const path = `/sheets/${id}/image`;
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch (e) {
      throw await describeFetchFailure(e, "GET", path);
    }
    if (res.status === 401) {
      tokenStore.clear();
      clearApiCache();
      if (onUnauthorized) onUnauthorized();
      throw apiError("Your session has expired. Please sign in again.", "auth", 401);
    }
    if (!res.ok) {
      // The endpoint returns a JSON reason. Without it a 404 is ambiguous
      // between "no such sheet" (a stale row) and "the scan is no longer on
      // the server" (the file went with a pod restart, or landed on a
      // different replica's disk) — different problems, different fixes.
      const body = await res.json().catch(() => null);
      throw apiError(
        body?.error || `Could not load sheet image (${res.status})`,
        "http",
        res.status
      );
    }
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

  // Record a practice-forms user (name + phone) — used to gate/track everyone
  // who enters the exam-forms portal. Best-effort: a logging failure never
  // blocks the user. Backend writes it to DynamoDB (creds stay server-side).
  logExamFormEntry: (payload) => toolLog("/exam-forms/save", payload),

  // Pull a response-sheet page down through the backend. It cannot be fetched
  // here: the exam CDNs send no CORS headers and reject a non-browser
  // User-Agent. Parsing still happens in the browser — see answerKey.js.
  fetchAnswerKeyUrl: (url) =>
    toolCall("/tools/answerkey-checker/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),

  /* Recover the text from a response sheet whose pages are images.
   *
   * Needed because the copies of these papers in circulation have often been
   * re-saved through a PDF editor, which flattens every page into a picture: no
   * fonts, no text, nothing for the browser reader to extract. The backend
   * rasterises and OCRs them (see backend/pdf_ocr.py) and returns the lines,
   * which are then parsed here exactly like a text PDF's.
   *
   * A long paper arrives in instalments. The server reads for a bounded stretch
   * and answers with `nextPage` where it stopped; this posts the file again from
   * there until the document is done. Reading a 37-page scan in one request took
   * long enough that the production gateway returned a 504, and the candidate
   * saw an upload that had read nothing at all.
   *
   * Returns the lines, or null where OCR is unavailable or fails — the caller
   * then reports the file as a scan it cannot read, which is what it did before
   * this existed. Null, specifically, rather than the pages read so far: half a
   * paper parses into a plausible-looking half score, and quietly marking
   * somebody against 60 of their 100 questions is worse than telling them the
   * file could not be read. The error is not swallowed silently: it is logged,
   * and the distinction between "no engine" and "could not read it" is kept in
   * the message so a misconfigured server is diagnosable from the browser
   * console.
   *
   * `onProgress(pagesRead, pages)` is called after each instalment so the page
   * can show movement through a read that takes a while.
   */
  keyCheckOcr: async (file, onProgress) => {
    /* Enough for the server's 120-page limit at the rate a slow host manages
       inside one instalment (~10 pages), with room to spare. It is a backstop
       against a read that will never finish — each round re-posts the file, so
       twenty of them is already several minutes and a lot of upload — not a
       limit any real paper is meant to reach. */
    const MAX_ROUNDS = 20;
    const lines = [];
    let first = 1;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const body = new FormData();
        body.append("file", file, file.name || "sheet.pdf");
        body.append("first", String(first));
        const res = await toolCall("/tools/answerkey-checker/ocr", { method: "POST", body });
        if (!Array.isArray(res?.lines)) return null;
        lines.push(...res.lines);

        const next = res.nextPage;
        if (next == null) return lines;
        // A cursor that has not moved past where this instalment began means no
        // progress is being made; stopping beats posting the same file forever.
        if (!(next > first)) {
          console.warn("scanned-sheet OCR made no progress at page", first);
          return null;
        }
        first = next;
        onProgress?.(first - 1, res.pages || 0);
      }
      console.warn("scanned-sheet OCR did not finish in", MAX_ROUNDS, "requests");
      return null;
    } catch (err) {
      console.warn("scanned-sheet OCR failed:", err.message);
      return null;
    }
  },

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

  // Marking schemes an admin has pinned per exam. Read once when the checker
  // loads. Resolves to {} on any failure rather than throwing: the tool then
  // uses its built-in presets, which is what it did before this existed — a
  // warehouse blip must never stop a candidate scoring their paper.
  keyCheckSchemes: async () => {
    try {
      const body = await toolCall("/tools/answerkey-checker/schemes");
      return body?.schemes || {};
    } catch (err) {
      console.warn("marking schemes lookup failed:", err.message);
      return {};
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
