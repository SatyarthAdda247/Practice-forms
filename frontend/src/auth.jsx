import { createContext, useContext, useEffect, useState } from "react";

const AuthCtx = createContext(null);
const STORAGE_USER_KEY = "adda247_student_session";

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_USER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const loginWithGoogle = (googleUserData) => {
    const studentUser = {
      name: googleUserData?.name || "Student Aspirant",
      email: googleUserData?.email || "aspirant@gmail.com",
      picture: googleUserData?.picture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
      id: googleUserData?.sub || `google-${Date.now()}`,
    };
    try {
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(studentUser));
    } catch {
      /* ignore */
    }
    setUser(studentUser);
  };

  const logout = () => {
    try {
      localStorage.removeItem(STORAGE_USER_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loginWithGoogle, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
