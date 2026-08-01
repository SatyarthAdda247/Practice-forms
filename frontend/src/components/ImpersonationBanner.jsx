// ─── src/components/ImpersonationBanner.jsx ──────────────────────────────────
// Persistent marker that the current session is borrowed. It is deliberately
// loud and always present: an admin who forgets they are impersonating can
// mistake another user's data for their own, or act on it believing they are
// themselves. The exit lives here so leaving is never more than one click.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useAuth } from "../auth.jsx";

export default function ImpersonationBanner() {
  const { user, stopImpersonating } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const actor = user?.impersonator;
  if (!actor) return null;

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await stopImpersonating();
      navigate("/admin", { replace: true });
    } catch (e) {
      // The session may have already lapsed — impersonation tokens are
      // short-lived. Say so rather than leaving a dead banner on screen.
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-tertiary-container text-on-tertiary-container border-b border-outline-variant">
      <div className="flex items-center justify-center gap-md px-lg py-xs flex-wrap">
        <Icon name="visibility" size={16} filled />
        <span className="font-body-sm text-body-sm">
          Viewing as <strong>{user.name}</strong> ({user.email}) — signed in as {actor.email}
        </span>
        <button
          onClick={stop}
          disabled={busy}
          className="px-md py-0.5 rounded-full bg-on-tertiary-container text-tertiary-container font-label-md text-label-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {busy ? "Exiting…" : "Stop"}
        </button>
        {error && <span className="font-body-sm text-body-sm text-error">{error}</span>}
      </div>
    </div>
  );
}
