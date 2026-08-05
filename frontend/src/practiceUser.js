// ─── src/practiceUser.js ─────────────────────────────────────────────────────
// The exam-forms portal identifies its users by a custom Name + Phone + Email gate
// (instead of Google sign-in). This store persists identity in localStorage,
// tracks user log history for the Admin panel, and increments total visitor counts.

import { useEffect, useState } from "react";

const KEY = "adda_practice_user";
const EVT = "practiceuserchange";
const LOGINS_KEY = "adda_portal_logins_history";
const VISITORS_KEY = "adda_website_visitor_count";

export function trackVisitor() {
  try {
    let count = parseInt(localStorage.getItem(VISITORS_KEY) || "0", 10);
    if (!sessionStorage.getItem("adda_visited_session")) {
      count += 1;
      localStorage.setItem(VISITORS_KEY, count.toString());
      sessionStorage.setItem("adda_visited_session", "true");
    }
    return count;
  } catch {
    return 1;
  }
}

export function getVisitorCount() {
  try {
    return parseInt(localStorage.getItem(VISITORS_KEY) || "1", 10);
  } catch {
    return 1;
  }
}

export function getPracticeUser() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (u && u.name && u.phone && u.email) return u;
    return null;
  } catch {
    return null;
  }
}

export function setPracticeUser(user) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));

    // Record login entry in admin portal history store
    const historyRaw = localStorage.getItem(LOGINS_KEY);
    let history = historyRaw ? JSON.parse(historyRaw) : [];
    const idx = history.findIndex(
      (h) => (h.phone && h.phone === user.phone) || (h.email && h.email.toLowerCase() === user.email.toLowerCase())
    );
    const entry = {
      ...user,
      id: user.id || "REG-" + Math.floor(100000 + Math.random() * 900000),
      timestamp: user.timestamp || new Date().toISOString(),
      lastActive: new Date().toISOString()
    };
    if (idx !== -1) {
      history[idx] = { ...history[idx], ...entry };
    } else {
      history.unshift(entry);
    }
    localStorage.setItem(LOGINS_KEY, JSON.stringify(history));
  } catch (e) {
    console.error("Error setting practice user:", e);
  }
  window.dispatchEvent(new Event(EVT));
}

export function getPortalLoginsHistory() {
  try {
    const raw = localStorage.getItem(LOGINS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearPracticeUser() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

export function usePracticeUser() {
  const [user, setUser] = useState(getPracticeUser);
  useEffect(() => {
    trackVisitor();
    const sync = () => setUser(getPracticeUser());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return user;
}
