import { createContext, useContext, useEffect, useState } from "react";
import { api, tokenStore, setUnauthorizedHandler } from "./api.js";

// Auth context: holds the signed-in user, exposes login/logout, and validates
// any persisted session token on startup.
const AuthCtx = createContext(null);

export function useAuth() {
  return useContext(AuthCtx);
}

// --- TEMPORARY: fake dev user until login is re-enabled ---
const _DEV_USER = {
  id: 0,
  email: "dev@localhost",
  name: "Dev User",
  picture: null,
  role: "super_admin",
  active: true,
};

export function AuthProvider({ children }) {
  // --- ORIGINAL (commented out until login is re-enabled) ---
  // const [user, setUser] = useState(null);
  // const [loading, setLoading] = useState(true);
  //
  // useEffect(() => {
  //   setUnauthorizedHandler(() => setUser(null));
  //   if (tokenStore.get()) {
  //     api
  //       .me()
  //       .then(setUser)
  //       .catch(() => tokenStore.clear())
  //       .finally(() => setLoading(false));
  //   } else {
  //     setLoading(false);
  //   }
  // }, []);
  //
  // const login = (token, u) => {
  //   tokenStore.set(token);
  //   setUser(u);
  // };
  //
  // const logout = async () => {
  //   try { await api.logout(); } catch { }
  //   tokenStore.clear();
  //   setUser(null);
  // };

  const user = _DEV_USER;
  const loading = false;
  const login = () => {};
  const logout = () => {};
  // --- END TEMPORARY ---

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

