// Thin fetch wrapper around the Flask API.
// - Dev: leave VITE_API_BASE_URL unset -> "/api" (Vite proxies it to :5000).
// - Split-domain prod: set VITE_API_BASE_URL to the backend origin at build
//   time (e.g. https://aspirant-portal-api.adda247.com) -> "<origin>/api".
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
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

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

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

  // Exams + answer keys
  listExams: () => request("/exams"),
  getExam: (id) => request(`/exams/${id}`),
  createExam: (data) => request("/exams", json("POST", data)),
  updateExam: (id, data) => request(`/exams/${id}`, json("PUT", data)),
  deleteExam: (id) => request(`/exams/${id}`, { method: "DELETE" }),

  // Uploads
  listSheets: (id) => request(`/exams/${id}/sheets`),
  uploadSheets: (id, files) => {
    const fd = new FormData();
    [...files].forEach((f) => fd.append("files", f));
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
