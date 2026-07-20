import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import GoogleSignIn from "../components/GoogleSignIn.jsx";
import Icon from "../components/Icon.jsx";
import BetaBadge from "../components/BetaBadge.jsx";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const from = location.state?.from || "/exams";
  if (user) return <Navigate to={from} replace />;

  const handleCredential = async (credential) => {
    setBusy(true);
    setError("");
    try {
      const { token, user: u } = await api.googleLogin(credential);
      login(token, u);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-lg">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center mb-xl">
          <div className="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center text-on-primary mb-md">
            <Icon name="domain" filled size={28} />
          </div>
          <div className="flex items-center gap-sm">
            <h1 className="font-headline-lg text-headline-lg text-primary">OMR GradePro</h1>
            <BetaBadge />
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
            Academic Session 2026-2027
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-xl shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <h2 className="font-headline-sm text-headline-sm text-on-background text-center mb-xs">
            Sign in to continue
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant text-center mb-lg">
            Use your institution Google account to access the dashboard.
          </p>

          {error && (
            <div className="mb-lg p-md rounded-lg bg-error-container text-on-error-container font-body-sm">
              {error}
            </div>
          )}

          <div className={busy ? "opacity-50 pointer-events-none" : ""}>
            <GoogleSignIn onCredential={handleCredential} onError={setError} />
          </div>

          {busy && (
            <p className="text-center font-body-sm text-secondary mt-md">Signing you in…</p>
          )}
        </div>

        <p className="text-center font-body-sm text-body-sm text-on-surface-variant mt-lg">
          By signing in you agree to the acceptable-use policy.
        </p>
      </div>
    </div>
  );
}
