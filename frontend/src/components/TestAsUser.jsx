// ─── src/components/TestAsUser.jsx ───────────────────────────────────────────
// "Test as User" — lets a super admin view the portal through another user's
// account to reproduce what they are seeing. Rendered only for super admins,
// and only outside an existing impersonation; the API enforces both
// independently (POST /api/admin/impersonate), so this is presentation only.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useAuth } from "../auth.jsx";

export default function TestAsUser({ onClose }) {
  const { user, impersonate } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user?.role !== "super_admin" || user?.impersonator) return null;

  const submit = async (e) => {
    e.preventDefault();
    const target = email.trim();
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      await impersonate(target);
      // Land on the default page rather than whatever admin-only route we were
      // on — the borrowed account may have no right to be there.
      navigate("/exams", { replace: true });
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-sm mb-sm p-md rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="flex items-center justify-between mb-sm">
        <span className="font-label-md text-label-md text-on-surface">Test as User</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Test as User"
            className="text-on-surface-variant hover:text-on-surface rounded-full p-1 transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      <form onSubmit={submit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@adda247.com"
          autoComplete="off"
          disabled={busy}
          className="w-full px-md py-sm mb-sm rounded-lg border border-outline-variant bg-surface font-body-sm text-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="w-full py-sm px-md rounded-lg bg-tertiary-container text-on-tertiary-container font-label-md text-label-md hover:brightness-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Starting…" : "Impersonate"}
        </button>
      </form>

      {error && (
        <p className="mt-sm font-body-sm text-body-sm text-error break-words">{error}</p>
      )}
    </div>
  );
}
