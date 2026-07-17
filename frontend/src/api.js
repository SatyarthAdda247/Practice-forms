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

async function request(path, options = {}) {
  const token = tokenStore.get();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    tokenStore.clear();
    if (onUnauthorized) onUnauthorized();
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (res.status === 204) return null;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((body && body.error) || `Request failed (${res.status})`);
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
  deleteSheet: (id) => request(`/sheets/${id}`, { method: "DELETE" }),
  validation: (id) => request(`/exams/${id}/validation`),

  // Grading + results
  grade: (id) => request(`/exams/${id}/grade`, { method: "POST" }),
  results: (id) => request(`/exams/${id}/results`),
};
