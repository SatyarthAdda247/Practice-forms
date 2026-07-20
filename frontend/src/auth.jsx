import { createContext, useContext, useEffect, useState } from "react";
import { api, tokenStore, setUnauthorizedHandler } from "./api.js";

// Auth context: holds the signed-in user, exposes login/logout, and validates
// any persisted session token on startup.
const AuthCtx = createContext(null);

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (tokenStore.get()) {
      api
        .me()
        .then(setUser)
        .catch(() => tokenStore.clear())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = (token, u) => {
    tokenStore.set(token);
    setUser(u);
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore network errors on logout */
    }
    tokenStore.clear();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

