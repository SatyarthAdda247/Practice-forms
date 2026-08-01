import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearApiCache, setUnauthorizedHandler, tokenStore } from "./api.js";

const AuthCtx = createContext(null);

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Start busy whenever a token is on disk: the session is unproven until
  // /auth/me confirms it, and RequireAuth must not bounce to /login in the
  // meantime. With no token there is nothing to verify, so skip the spinner.
  const [loading, setLoading] = useState(() => Boolean(tokenStore.get()));

  const clearSession = useCallback(() => {
    tokenStore.clear();
    clearApiCache();
    setUser(null);
  }, []);

  // A 401 from any request means the token is dead — drop the session so the
  // route guards send the user back to /login. request() has already cleared
  // the token and the cache by the time this fires.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  // Restore the session on boot. The token is the only thing that survives a
  // reload; role and canViewLeads must come from the server, since trusting a
  // cached copy would let a doctored localStorage entry unlock admin routes.
  // The API enforces this too — this only gates what renders.
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    api
      .me()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback((token, u) => {
    tokenStore.set(token);
    clearApiCache();
    setUser(u);
    setLoading(false);
  }, []);

  const logout = useCallback(() => {
    // Best-effort server-side revoke; the local session goes either way, so a
    // network failure can never strand someone in a signed-in state.
    api.logout().catch(() => {});
    clearSession();
  }, [clearSession]);

  // "Test as User". Both directions replace the session outright and drop the
  // GET cache, so nothing the previous identity fetched can bleed into the new
  // one's view. Errors propagate — the caller decides how to show them, and a
  // failed switch must leave the current session untouched.
  const impersonate = useCallback(
    async (email) => {
      const { token, user: u } = await api.impersonate(email);
      login(token, u);
      return u;
    },
    [login],
  );

  const stopImpersonating = useCallback(async () => {
    const { token, user: u } = await api.stopImpersonating();
    login(token, u);
    return u;
  }, [login]);

  return (
    <AuthCtx.Provider
      value={{ user, loading, login, logout, impersonate, stopImpersonating }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
