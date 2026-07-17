import { NavLink } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useAuth } from "../auth.jsx";

// Mobile-only bottom tab bar (hidden on md+, where the side nav takes over).
const TABS = [
  { to: "/dashboard", label: "Home", icon: "dashboard" },
  { to: "/exams", label: "Exams", icon: "assignment" },
  { to: "/upload", label: "Uploads", icon: "cloud_upload" },
  { to: "/results", label: "Results", icon: "analytics" },
];
const ADMIN_TAB = { to: "/admin", label: "Admin", icon: "admin_panel_settings" };
const SETTINGS_TAB = { to: "/settings", label: "Settings", icon: "settings" };

export default function BottomNav() {
  const { user } = useAuth();
  const tabs = [
    ...TABS,
    ...(["admin", "super_admin"].includes(user?.role) ? [ADMIN_TAB] : []),
    SETTINGS_TAB,
  ];
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-container-low border-t border-outline-variant flex justify-around items-stretch h-16 pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className="flex-1 flex flex-col items-center justify-center gap-xs pt-xs"
        >
          {({ isActive }) => (
            <>
              <span
                className={`flex items-center justify-center h-7 w-14 rounded-full transition-colors ${
                  isActive ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant"
                }`}
              >
                <Icon name={t.icon} filled={isActive} size={22} />
              </span>
              <span
                className={`font-label-md text-[11px] leading-none ${
                  isActive ? "text-on-secondary-container" : "text-on-surface-variant"
                }`}
              >
                {t.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
