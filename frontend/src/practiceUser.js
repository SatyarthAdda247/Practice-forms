// ─── src/practiceUser.js ─────────────────────────────────────────────────────
// The exam-forms portal identifies its users by a custom Name + Phone gate
// (instead of Google sign-in). This tiny store persists that identity in
// localStorage — shared with the same-origin practice-form iframes — and lets
// React components react to changes.

import { useEffect, useState } from "react";

const KEY = "adda_practice_user";
const EVT = "practiceuserchange";

export function getPracticeUser() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (u && u.name && u.phone) return u;
    return null;
  } catch {
    return null;
  }
}

export function setPracticeUser(user) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    /* storage disabled — ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

export function clearPracticeUser() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

// React hook: current practice user, updating when it changes (this tab or
// another tab via the native `storage` event).
export function usePracticeUser() {
  const [user, setUser] = useState(getPracticeUser);
  useEffect(() => {
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
