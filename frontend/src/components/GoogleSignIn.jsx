import { useEffect, useRef } from "react";

// Google Identity Services (GIS) button. Loads the GIS script once, renders the
// official button, and hands the returned ID token to `onCredential`.
// Configure the client id via the VITE_GOOGLE_CLIENT_ID env var.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GIS_SRC = "https://accounts.google.com/gsi/client";

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    let el = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (el) {
      el.addEventListener("load", () => resolve());
      el.addEventListener("error", () => reject(new Error("Failed to load Google script")));
      return;
    }
    el = document.createElement("script");
    el.src = GIS_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Failed to load Google script"));
    document.head.appendChild(el);
  });
}

export default function GoogleSignIn({ onCredential, onError }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!CLIENT_ID) {
      onError?.(
        "Missing VITE_GOOGLE_CLIENT_ID. Add it to frontend/.env.local and restart the dev server."
      );
      return;
    }
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (resp) => onCredential(resp.credential),
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: 300,
        });
      })
      .catch((e) => onError?.(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return <div ref={ref} className="flex justify-center min-h-[44px]" />;
}
