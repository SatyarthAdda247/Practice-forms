import { useEffect, useRef } from "react";

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

export default function GoogleSignIn({ onLogin }) {
  const gisRef = useRef(null);

  useEffect(() => {
    if (!CLIENT_ID) return;

    loadGis()
      .then(() => {
        if (!gisRef.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (resp) => {
            // Decode simple payload or invoke onLogin
            onLogin?.({
              name: "Adda247 Aspirant",
              email: "student@gmail.com",
              picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
            });
          },
        });
        window.google.accounts.id.renderButton(gisRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
        });
      })
      .catch(() => {});
  }, [onLogin]);

  const handleSimulatedGoogleClick = () => {
    onLogin?.({
      name: "Amit Kumar",
      email: "amit.kumar.student@gmail.com",
      picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
    });
  };

  if (CLIENT_ID) {
    return <div ref={gisRef} className="flex justify-center min-h-[44px]" />;
  }

  return (
    <button
      onClick={handleSimulatedGoogleClick}
      className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs border border-slate-300 shadow-sm hover:shadow transition-all duration-200"
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        />
      </svg>
      <span>Sign in with Google</span>
    </button>
  );
}
